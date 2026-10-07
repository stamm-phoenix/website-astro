import { Kysely, MssqlDialect, sql } from 'kysely';
import type { Transaction } from 'kysely';
import * as Tarn from 'tarn';
import * as Tedious from 'tedious';
import { CONFIG } from './config';
import type { Database } from './db-schema';
import { getCredential } from './token';

/** The database or a running transaction; data functions accept both. */
export type Db = Kysely<Database> | Transaction<Database>;

export interface DatabaseTarget {
  server: string;
  database: string;
  port?: number;
  authentication: Tedious.ConnectionAuthentication;
  /** Only for the local test container with its self-signed certificate. */
  trustServerCertificate?: boolean;
  /** Milliseconds per statement; 30 seconds unless a script needs longer (CREATE DATABASE). */
  requestTimeout?: number;
}

let instance: Kysely<Database> | undefined;
let override: DatabaseTarget | undefined;

/** Azure SQL with the certificate of the app registration (Entra authentication only). */
function configuredTarget(): DatabaseTarget {
  return {
    server: CONFIG.database.server,
    database: CONFIG.database.name,
    authentication: { type: 'token-credential', options: { credential: getCredential() } },
  };
}

export function createDatabase(target: DatabaseTarget): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new MssqlDialect({
      tarn: { ...Tarn, options: { min: 0, max: 10, idleTimeoutMillis: 60_000 } },
      tedious: {
        ...Tedious,
        connectionFactory: () =>
          new Tedious.Connection({
            server: target.server,
            authentication: target.authentication,
            options: {
              database: target.database,
              port: target.port ?? 1433,
              encrypt: true,
              trustServerCertificate: target.trustServerCertificate ?? false,
              connectTimeout: 30_000,
              requestTimeout: target.requestTimeout ?? 30_000,
              // Dates are UTC on both sides; never the host's time zone.
              useUTC: true,
            },
          }),
      },
    }),
  });
}

/** The shared connection pool of this process. */
export function getDb(): Kysely<Database> {
  instance ??= createDatabase(override ?? configuredTarget());
  return instance;
}

/** Points the pool at another database (tests, local scripts). Returns a function to close it. */
export function useDatabase(target: DatabaseTarget): () => Promise<void> {
  override = target;
  instance = undefined;
  return async () => {
    const current = instance;
    override = undefined;
    instance = undefined;
    await current?.destroy();
  };
}

/** A conditional write found a newer version than the one loaded by the caller. */
export class VersionConflictError extends Error {
  readonly statusCode = 412;

  constructor() {
    super('Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
    this.name = 'VersionConflictError';
  }
}

/** The row to change does not exist (any more). */
export class RecordNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Der Eintrag wurde nicht gefunden.');
    this.name = 'RecordNotFoundError';
  }
}

/** SQL Server error number of a failed request, if any. */
export function getSqlErrorNumber(error: unknown): number | undefined {
  const value = (error as { number?: unknown })?.number;
  return typeof value === 'number' ? value : undefined;
}

const DEADLOCK = 1205;
const MAX_ATTEMPTS = 3;

/**
 * Runs `work` in one transaction and commits only if it completes. A deadlock victim is
 * retried, so `work` must not have side effects outside the database.
 */
export async function inTransaction<T>(
  work: (trx: Transaction<Database>) => Promise<T>
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await getDb().transaction().execute(work);
    } catch (error: unknown) {
      if (getSqlErrorNumber(error) !== DEADLOCK || attempt >= MAX_ATTEMPTS) throw error;
    }
  }
}

/**
 * Serializes transactions working on the same resource (e.g. the capacity of all slots or one
 * Dispo plan) until the transaction ends.
 */
export async function lockResource(trx: Transaction<Database>, resource: string): Promise<void> {
  const result = await sql<{ result: number }>`
    DECLARE @result int;
    EXEC @result = sp_getapplock
      @Resource = ${resource}, @LockMode = 'Exclusive', @LockOwner = 'Transaction',
      @LockTimeout = 20000;
    SELECT @result AS result;
  `.execute(trx);
  if ((result.rows[0]?.result ?? -1) < 0) throw new Error(`Lock ${resource} not granted`);
}

/** The version of a row as sent to clients, in the quoted form of an ETag. */
export function toVersion(rowversion: Buffer): string {
  return `"${rowversion.toString('hex')}"`;
}

/** The rowversion of a client version, or `undefined` if it is malformed. */
export function fromVersion(version: string | undefined): Buffer | undefined {
  const match = /^"([0-9a-f]{16})"$/.exec(version?.trim() ?? '');
  return match ? Buffer.from(match[1], 'hex') : undefined;
}

/** Requires a well-formed version, so a missing one never becomes an unconditional write. */
export function requireVersion(version: string | undefined): Buffer {
  const parsed = fromVersion(version);
  if (!parsed) throw new VersionConflictError();
  return parsed;
}

/** Date-only columns arrive as UTC midnight; this returns `YYYY-MM-DD`. */
export function toDateString(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** Reads a JSON array of strings from a column; anything else becomes an empty list. */
export function parseStringList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Parses a numeric ID from a route or a client; anything else is no ID. */
export function parseId(id: string): number | undefined {
  return /^\d{1,9}$/.test(id) ? Number(id) : undefined;
}

/** Closes the connection pool, if one was opened (scripts call this before exiting). */
export async function closeDatabase(): Promise<void> {
  const current = instance;
  instance = undefined;
  await current?.destroy();
}
