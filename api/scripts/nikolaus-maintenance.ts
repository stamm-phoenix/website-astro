/** Operator recovery for the durable Nikolaus write gate. Status never changes it. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  beginNikolausMaintenance,
  endNikolausMaintenance,
  readNikolausWriteGate,
  recoverStoppedNikolausWriters,
  type NikolausWriteGateState,
} from '../lib/nikolaus-write-gate';
import { getGraphStatus } from '../lib/sharepoint-data-access';

interface Arguments {
  mode: 'help' | 'status' | 'recover';
  owner?: string;
  writers: string[];
}

class OperatorError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OperatorError';
  }
}

function identifier(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9:_.-]{1,180}$/.test(value);
}

function argumentsFrom(argv: string[]): Arguments {
  const flags = new Set(['--help', '--status', '--recover', '--processes-stopped-confirmed']);
  const values = new Set(['--owner', '--writers']);
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (args.has(name)) throw new OperatorError('INVALID_ARGUMENTS');
    if (flags.has(name)) args.set(name, 'true');
    else if (values.has(name) && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args.set(name, argv[++index]);
    } else throw new OperatorError('INVALID_ARGUMENTS');
  }
  if (args.has('--help')) {
    if (args.size !== 1) throw new OperatorError('INVALID_ARGUMENTS');
    return { mode: 'help', writers: [] };
  }
  if (args.has('--status')) {
    if (args.size !== 1) throw new OperatorError('INVALID_ARGUMENTS');
    return { mode: 'status', writers: [] };
  }
  const owner = args.get('--owner');
  if (!args.has('--recover') || !args.has('--processes-stopped-confirmed') || !identifier(owner)) {
    throw new OperatorError('RECOVERY_CONFIRMATION_REQUIRED');
  }
  const writers = args.has('--writers')
    ? args
        .get('--writers')!
        .split(',')
        .map((id) => id.trim())
    : [];
  if (
    writers.length > 1000 ||
    !writers.every(identifier) ||
    new Set(writers).size !== writers.length
  ) {
    throw new OperatorError('INVALID_WRITER_IDS');
  }
  return { mode: 'recover', owner, writers };
}

function settings(): void {
  try {
    const parsed = JSON.parse(
      readFileSync(resolve(__dirname, '../local.settings.json'), 'utf8')
    ) as {
      Values?: Record<string, string>;
    };
    for (const [key, value] of Object.entries(parsed.Values ?? {})) process.env[key] ??= value;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new OperatorError('CONFIGURATION');
  }
}

function show(
  state: NikolausWriteGateState,
  action: 'status' | 'recovered' | 'writers_remaining'
): void {
  console.log(
    JSON.stringify({
      scope: 'nikolaus_maintenance',
      action,
      state: state.maintenance ? 'maintenance' : 'open',
      owner: state.maintenance?.owner ?? null,
      maintenanceStartedAt: state.maintenance?.startedAt ?? null,
      writers: state.writers.map(({ id, startedAt }) => ({ id, startedAt })),
    })
  );
}

function assertRecoveryTarget(
  state: NikolausWriteGateState,
  owner: string,
  writers: string[]
): void {
  if (state.maintenance && state.maintenance.owner !== owner)
    throw new OperatorError('OWNER_MISMATCH');
  const known = new Set(state.writers.map((writer) => writer.id));
  if (writers.some((id) => !known.has(id))) throw new OperatorError('UNKNOWN_WRITER_IDS');
}

async function main(): Promise<void> {
  const args = argumentsFrom(process.argv.slice(2));
  if (args.mode === 'help') {
    console.log('Read-only status: bun scripts/nikolaus-maintenance.ts --status');
    console.log(
      'Recover stopped processes: bun scripts/nikolaus-maintenance.ts --recover --owner ID [--writers ID,ID] --processes-stopped-confirmed'
    );
    console.log(
      'Confirm that the maintenance job and every listed writer process have terminated. Paused or old processes are not sufficient.'
    );
    console.log(
      'Use the current owner from --status. If none exists, choose a new owner ID. Unknown writer IDs are rejected.'
    );
    console.log(
      'Remaining writers keep maintenance closed; inspect --status before another recovery. No booking data is deleted.'
    );
    return;
  }
  settings();
  const initial = await readNikolausWriteGate();
  if (args.mode === 'status') {
    show(initial, 'status');
    return;
  }
  const owner = args.owner!;
  // Validate before claiming so an unknown ID cannot create a new maintenance lock.
  assertRecoveryTarget(initial, owner, args.writers);
  if (!initial.maintenance) await beginNikolausMaintenance(owner);
  const claimed = await readNikolausWriteGate();
  assertRecoveryTarget(claimed, owner, args.writers);
  if (claimed.maintenance?.owner !== owner) throw new OperatorError('OWNER_MISMATCH');
  await recoverStoppedNikolausWriters(owner, args.writers, { confirmedStopped: true });
  const remaining = await readNikolausWriteGate();
  if (remaining.maintenance?.owner !== owner) throw new OperatorError('OWNER_MISMATCH');
  if (remaining.writers.length > 0) {
    show(remaining, 'writers_remaining');
    process.exitCode = 1;
    return;
  }
  await endNikolausMaintenance(owner);
  show(await readNikolausWriteGate(), 'recovered');
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      scope: 'nikolaus_maintenance',
      status: 'failed',
      errorCode: error instanceof OperatorError ? error.code : (getGraphStatus(error) ?? 'UNKNOWN'),
    })
  );
  process.exitCode = 1;
});
