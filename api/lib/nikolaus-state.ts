import { EnvironmentVariable, getEnvironment } from './environment';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  createSharePointListItem,
  deleteSharePointListItem,
  getGraphStatus,
  getSharePointListItems,
  updateSharePointListItem,
} from './sharepoint-data-access';

export interface NikolausStateRecord {
  id: string;
  key: string;
  etag: string;
  data: unknown;
}

export class NikolausStateConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('Der gemeinsame Nikolaus-Zustand wurde inzwischen geändert. Bitte erneut laden.');
    this.name = 'NikolausStateConflictError';
  }
}

export class InvalidNikolausStateError extends Error {
  constructor(key: string) {
    super(`Invalid stored Nikolaus state: ${key}`);
    this.name = 'InvalidNikolausStateError';
  }
}

export class NikolausStateSizeError extends Error {
  readonly statusCode = 413;

  constructor() {
    super(
      'Die Planung ist zu groß für den gemeinsamen Speicher. Bitte die Einteilung verkleinern.'
    );
    this.name = 'NikolausStateSizeError';
  }
}

const MAX_STORED_CHARACTERS = 60_000;
const MAX_JSON_BYTES = 1_000_000;

export function serializeNikolausState(data: unknown): string {
  const json = JSON.stringify(data);
  if (json === undefined || Buffer.byteLength(json) > MAX_JSON_BYTES)
    throw new NikolausStateSizeError();
  if (json.length <= 50_000) return json;
  const compressed = JSON.stringify({
    format: 'nikolaus-state-gzip-v1',
    payload: gzipSync(json).toString('base64'),
  });
  if (compressed.length > MAX_STORED_CHARACTERS) throw new NikolausStateSizeError();
  return compressed;
}

function deserialize(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).format === 'nikolaus-state-gzip-v1'
  ) {
    const payload = (parsed as Record<string, unknown>).payload;
    if (typeof payload !== 'string') throw new Error('Invalid compressed state');
    return JSON.parse(
      gunzipSync(Buffer.from(payload, 'base64'), { maxOutputLength: MAX_JSON_BYTES }).toString(
        'utf8'
      )
    ) as unknown;
  }
  return parsed;
}

function listId(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_STATE_LIST_ID);
}

function validateKey(key: string): void {
  if (!/^[a-zA-Z0-9:_.-]{1,180}$/.test(key)) throw new Error('Invalid Nikolaus state key');
}

function record(raw: unknown): NikolausStateRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new InvalidNikolausStateError('unknown');
  const row = raw as Record<string, unknown>;
  if (!row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields))
    throw new InvalidNikolausStateError('unknown');
  const fields = row.fields as Record<string, unknown>;
  const key = typeof fields.OperationKey === 'string' ? fields.OperationKey : 'unknown';
  if (
    typeof row.id !== 'string' ||
    !row.id ||
    typeof row.eTag !== 'string' ||
    !row.eTag ||
    row.eTag === '*' ||
    typeof fields.State !== 'string' ||
    !fields.State
  )
    throw new InvalidNikolausStateError(key);
  validateKey(key);
  try {
    return { id: row.id, key, etag: row.eTag, data: deserialize(fields.State) };
  } catch {
    throw new InvalidNikolausStateError(key);
  }
}

/** The OperationKey column must enforce unique values in the shared list. */
export async function readNikolausState(key: string): Promise<NikolausStateRecord | undefined> {
  validateKey(key);
  const rows = await getSharePointListItems(listId(), {
    expand: 'fields',
    filter: `fields/OperationKey eq '${key}'`,
  });
  const matches = rows.map(record).filter((row) => row.key === key);
  if (matches.length > 1) throw new InvalidNikolausStateError(key);
  return matches[0];
}

/** Lists durable plans, including dates no longer present in the current season config. */
export async function listNikolausStates(prefix: string): Promise<NikolausStateRecord[]> {
  if (prefix) validateKey(prefix);
  const rows = await getSharePointListItems(listId(), { expand: 'fields' });
  const selected = prefix
    ? rows.filter((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
        const fields = (row as Record<string, unknown>).fields;
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return false;
        const key = (fields as Record<string, unknown>).OperationKey;
        return typeof key === 'string' && key.startsWith(prefix);
      })
    : rows;
  const parsed = selected.map(record);
  if (new Set(parsed.map((row) => row.key)).size !== parsed.length)
    throw new InvalidNikolausStateError(prefix);
  return parsed;
}

/** Changes one complete JSON value by CAS. The callback may run again after contention. */
export interface NikolausStateMutationOptions {
  maxAttempts?: number;
}

export async function mutateNikolausState<T>(
  key: string,
  parse: (value: unknown | undefined) => T,
  change: (current: T) => T | undefined,
  options: NikolausStateMutationOptions = {}
): Promise<T | undefined> {
  validateKey(key);
  const maxAttempts = options.maxAttempts ?? 6;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20)
    throw new Error('Invalid Nikolaus state retry budget');
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = 1 + Math.floor(Math.random() * Math.min(500, 25 * 2 ** (attempt - 1)));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const current = await readNikolausState(key);
    const next = change(parse(current?.data));
    if (next === undefined) return undefined;
    const serialized = serializeNikolausState(next);
    if (current && serialized === serializeNikolausState(current.data)) return next;
    try {
      if (current) {
        await updateSharePointListItem(listId(), current.id, { State: serialized }, current.etag);
      } else {
        await createSharePointListItem(listId(), {
          Title: key,
          OperationKey: key,
          State: serialized,
        });
      }
      return next;
    } catch (error: unknown) {
      const status = getGraphStatus(error);
      if (current && status === 412) continue;
      // Graph can report a unique-column collision as 400 or 409. Adopt only a real row.
      if (!current && (status === 400 || status === 409) && (await readNikolausState(key)))
        continue;
      throw error;
    }
  }
  throw new NikolausStateConflictError();
}

/** Conditional deletion is safe to repeat after a partially completed operator cleanup. */
export async function deleteNikolausState(state: NikolausStateRecord): Promise<void> {
  validateKey(state.key);
  if (!state.etag || state.etag === '*') throw new InvalidNikolausStateError(state.key);
  try {
    await deleteSharePointListItem(listId(), state.id, state.etag);
  } catch (error: unknown) {
    if (getGraphStatus(error) === 404) return;
    if (getGraphStatus(error) === 412) throw new NikolausStateConflictError();
    throw error;
  }
}
