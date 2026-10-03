import { randomUUID } from 'node:crypto';
import { mutateNikolausState, readNikolausState } from './nikolaus-state';

export const NIKOLAUS_WRITE_GATE_KEY = 'maintenance:nikolaus:writes';

export interface NikolausActiveWriter {
  id: string;
  startedAt: string;
}

export interface NikolausWriteGateState {
  schema: 1;
  writers: NikolausActiveWriter[];
  maintenance?: { owner: string; startedAt: string };
}

export interface NikolausMaintenanceReadiness {
  ready: boolean;
  activeWriters: NikolausActiveWriter[];
}

export class NikolausMaintenanceError extends Error {
  readonly statusCode = 503;
  readonly code = 'MAINTENANCE';

  constructor(readonly maintenanceOwner?: string) {
    super('Der Nikolausdienst wird gewartet. Bitte versuchen Sie es später erneut.');
    this.name = 'NikolausMaintenanceError';
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9:_.-]{1,180}$/.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Neither writers nor maintenance owners expire. A paused process can still resume. */
export function parseNikolausWriteGate(value: unknown | undefined): NikolausWriteGateState {
  if (value === undefined) return { schema: 1, writers: [] };
  if (!object(value) || value.schema !== 1 || !Array.isArray(value.writers)) {
    throw new NikolausMaintenanceError();
  }
  const writers: NikolausActiveWriter[] = value.writers.map((writer: unknown) => {
    if (!object(writer) || !identifier(writer.id) || !timestamp(writer.startedAt)) {
      throw new NikolausMaintenanceError();
    }
    return { id: writer.id, startedAt: writer.startedAt };
  });
  if (new Set(writers.map((writer) => writer.id)).size !== writers.length) {
    throw new NikolausMaintenanceError();
  }
  if (value.maintenance === undefined) return { schema: 1, writers };
  if (
    !object(value.maintenance) ||
    !identifier(value.maintenance.owner) ||
    !timestamp(value.maintenance.startedAt)
  ) {
    throw new NikolausMaintenanceError();
  }
  return {
    schema: 1,
    writers,
    maintenance: { owner: value.maintenance.owner, startedAt: value.maintenance.startedAt },
  };
}

async function changeGate(
  change: (current: NikolausWriteGateState) => NikolausWriteGateState | undefined,
  maxAttempts = 6
): Promise<NikolausWriteGateState | undefined> {
  try {
    return await mutateNikolausState(NIKOLAUS_WRITE_GATE_KEY, parseNikolausWriteGate, change, {
      maxAttempts,
    });
  } catch (error: unknown) {
    if (error instanceof NikolausMaintenanceError) throw error;
    // Missing configuration, transport failure, malformed state and contention all deny writes.
    throw new NikolausMaintenanceError();
  }
}

export async function readNikolausWriteGate(): Promise<NikolausWriteGateState> {
  try {
    return parseNikolausWriteGate((await readNikolausState(NIKOLAUS_WRITE_GATE_KEY))?.data);
  } catch {
    throw new NikolausMaintenanceError();
  }
}

/** Admission must wrap the entire mutating operation, including dependent cleanup and mail. */
export async function runWithNikolausWriteGate<T>(handler: () => Promise<T>): Promise<T> {
  // Enable only after all production/preview writers are compatible or disabled and every
  // obsolete process has terminated. A mixed deployment cannot safely share ownership.
  if (process.env.NIKOLAUS_WRITES_ENABLED !== 'true') throw new NikolausMaintenanceError();
  const writer = { id: randomUUID(), startedAt: new Date().toISOString() };
  try {
    await changeGate((current) => {
      if (current.maintenance) throw new NikolausMaintenanceError(current.maintenance.owner);
      if (current.writers.length >= 1000) throw new NikolausMaintenanceError();
      return { ...current, writers: [...current.writers, writer] };
    });
    return await handler();
  } finally {
    // Also remove an ambiguous registration whose response was lost before the handler ran.
    await releaseWriter(writer.id);
  }
}

/**
 * A failed release leaves the registration intact and prevents retention from deleting.
 * It must not replace the outcome of the operation, which may already have saved and mailed.
 */
async function releaseWriter(id: string): Promise<void> {
  try {
    await changeGate(
      (current) =>
        current.writers.some((entry) => entry.id === id)
          ? { ...current, writers: current.writers.filter((entry) => entry.id !== id) }
          : undefined,
      12
    );
  } catch (error: unknown) {
    console.error(
      `Nikolaus writer ${id} could not be released; maintenance stays blocked until recovery`,
      error
    );
  }
}

/** Claims maintenance immediately and reports existing writers without waiting or deleting. */
export async function beginNikolausMaintenance(
  owner: string
): Promise<NikolausMaintenanceReadiness> {
  if (!identifier(owner)) throw new NikolausMaintenanceError();
  const startedAt = new Date().toISOString();
  const state = await changeGate((current) => {
    if (current.maintenance && current.maintenance.owner !== owner) {
      throw new NikolausMaintenanceError();
    }
    return {
      ...current,
      maintenance: current.maintenance ?? { owner, startedAt },
    };
  });
  if (!state) throw new NikolausMaintenanceError();
  return { ready: state.writers.length === 0, activeWriters: state.writers };
}

/** Only the identified owner may reopen admission after its cleanup process has stopped. */
export async function endNikolausMaintenance(owner: string): Promise<void> {
  if (!identifier(owner)) throw new NikolausMaintenanceError();
  await changeGate((current) => {
    if (!current.maintenance) return undefined;
    if (current.maintenance.owner !== owner) throw new NikolausMaintenanceError();
    return { schema: 1, writers: current.writers };
  });
}

/** Operator recovery requires verifying that these processes were terminated, not just paused. */
export async function recoverStoppedNikolausWriters(
  owner: string,
  writerIds: string[],
  confirmation: { confirmedStopped: true }
): Promise<void> {
  if (
    !identifier(owner) ||
    !Array.isArray(writerIds) ||
    !writerIds.every(identifier) ||
    confirmation?.confirmedStopped !== true
  ) {
    throw new NikolausMaintenanceError();
  }
  const stopped = new Set(writerIds);
  await changeGate((current) => {
    if (current.maintenance?.owner !== owner) throw new NikolausMaintenanceError();
    if (!current.writers.some((writer) => stopped.has(writer.id))) return undefined;
    return { ...current, writers: current.writers.filter((writer) => !stopped.has(writer.id)) };
  });
}
