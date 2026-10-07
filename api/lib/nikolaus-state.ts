import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import type { Database } from './db-schema';
import { getDb, inTransaction, toVersion } from './db';
import type { Db } from './db';

/** One JSON document of the table `nikolaus.state`. */
export interface NikolausStateRecord {
  key: string;
  version: string;
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

function validateKey(key: string): void {
  if (!/^[a-zA-Z0-9:_.-]{1,180}$/.test(key)) throw new Error('Invalid Nikolaus state key');
}

function record(row: { state_key: string; value: string; version: Buffer }): NikolausStateRecord {
  try {
    return { key: row.state_key, version: toVersion(row.version), data: JSON.parse(row.value) };
  } catch {
    throw new InvalidNikolausStateError(row.state_key);
  }
}

export async function readNikolausState(
  key: string,
  db: Db = getDb()
): Promise<NikolausStateRecord | undefined> {
  validateKey(key);
  const row = await db
    .selectFrom('nikolaus.state')
    .select(['state_key', 'value', 'version'])
    .where('state_key', '=', key)
    .executeTakeFirst();
  return row ? record(row) : undefined;
}

/** All documents whose key starts with `prefix`, ordered by key. */
export async function listNikolausStates(
  prefix: string,
  db: Db = getDb()
): Promise<NikolausStateRecord[]> {
  if (prefix) validateKey(prefix);
  const rows = await db
    .selectFrom('nikolaus.state')
    .select(['state_key', 'value', 'version'])
    .where('state_key', 'like', `${prefix.replace(/[[_%]/g, '[$&]')}%`)
    .orderBy('state_key')
    .execute();
  return rows.map(record);
}

/**
 * Changes one document under a row lock, so concurrent changes run one after the other.
 * `change` returns `undefined` to leave the document unchanged and may throw to abort.
 * @param trx Runs inside this transaction instead of an own one.
 */
export async function mutateNikolausState<T>(
  key: string,
  parse: (value: unknown | undefined) => T,
  change: (current: T) => T | undefined,
  trx?: Transaction<Database>
): Promise<T | undefined> {
  validateKey(key);
  const work = async (db: Transaction<Database>): Promise<T | undefined> => {
    const current = await sql<{ value: string }>`
      SELECT value FROM nikolaus.state WITH (UPDLOCK, HOLDLOCK) WHERE state_key = ${key}
    `.execute(db);
    const stored = current.rows[0]?.value;
    let data: unknown;
    if (stored !== undefined) {
      try {
        data = JSON.parse(stored);
      } catch {
        throw new InvalidNikolausStateError(key);
      }
    }
    const next = change(parse(data));
    if (next === undefined) return undefined;
    const value = JSON.stringify(next);
    if (value === undefined) throw new InvalidNikolausStateError(key);
    if (value === stored) return next;
    if (stored === undefined) {
      await db.insertInto('nikolaus.state').values({ state_key: key, value }).execute();
    } else {
      await db
        .updateTable('nikolaus.state')
        .set({ value, updated_at: new Date() })
        .where('state_key', '=', key)
        .execute();
    }
    return next;
  };
  return trx ? work(trx) : inTransaction(work);
}

export async function deleteNikolausState(key: string, db: Db = getDb()): Promise<void> {
  validateKey(key);
  await db.deleteFrom('nikolaus.state').where('state_key', '=', key).execute();
}
