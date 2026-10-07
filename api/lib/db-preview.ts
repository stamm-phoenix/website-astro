import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Database } from './db-schema';

/**
 * A database of its own for each PR preview (`website-pr-<number>`), so previews never touch
 * the production data. Created and seeded by the deploy workflow, dropped when the PR closes
 * (`scripts/db-preview.ts`, `docs/azure-sql.md`).
 */

const PR_NUMBER = /^[1-9]\d{0,5}$/;
const READY_TIMEOUT_MS = 5 * 60_000;

/** The database of a PR preview; throws for anything that is not a PR number. */
export function previewDatabaseName(pr: string | number): string {
  const value = String(pr);
  if (!PR_NUMBER.test(value)) throw new Error(`Invalid pull request number: ${value}`);
  return `website-pr-${value}`;
}

function assertPreviewName(name: string): void {
  if (!/^website-pr-[1-9]\d{0,5}$/.test(name)) throw new Error(`Not a preview database: ${name}`);
}

export async function databaseExists(master: Kysely<Database>, name: string): Promise<boolean> {
  const result = await sql<{ found: number }>`
    SELECT COUNT(*) AS found FROM sys.databases WHERE name = ${name}
  `.execute(master);
  return Number(result.rows[0]?.found ?? 0) > 0;
}

export interface CreatePreviewOptions {
  /** Azure SQL: the smallest tier with local backups. False for the SQL Server of the tests. */
  azure: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Creates the database if it does not exist yet and waits until it is online. Returns whether
 * it was created now. Runs in `master`; the creator becomes the owner of the new database.
 */
export async function createPreviewDatabase(
  master: Kysely<Database>,
  name: string,
  { azure, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: CreatePreviewOptions
): Promise<boolean> {
  assertPreviewName(name);
  const created = !(await databaseExists(master, name));
  if (created) {
    // The name is checked above; identifiers cannot be parameters
    const options = azure
      ? ` (EDITION = 'Basic', SERVICE_OBJECTIVE = 'Basic', MAXSIZE = 2 GB) WITH BACKUP_STORAGE_REDUNDANCY = 'LOCAL'`
      : '';
    await sql.raw(`CREATE DATABASE [${name}]${options}`).execute(master);
  }
  // Also an existing one may still be coming up, e.g. after an earlier run was cancelled
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const state = await sql<{ state: string }>`
      SELECT state_desc AS state FROM sys.databases WHERE name = ${name}
    `.execute(master);
    if (state.rows[0]?.state === 'ONLINE') return created;
    if (Date.now() > deadline) throw new Error(`Database ${name} did not come online`);
    await sleep(5_000);
  }
}

/** Drops the database of a preview; a missing one is fine (e.g. a PR closed twice). */
export async function dropPreviewDatabase(
  master: Kysely<Database>,
  name: string
): Promise<boolean> {
  assertPreviewName(name);
  if (!(await databaseExists(master, name))) return false;
  await sql.raw(`DROP DATABASE [${name}]`).execute(master);
  return true;
}

/**
 * Lets the website (its app registration) read and write the preview database. The user is
 * created from the client ID, without a lookup in Entra ID.
 */
export async function grantWebsiteAccess(db: Kysely<Database>, clientId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new Error('Invalid client ID');
  }
  await sql`
    IF DATABASE_PRINCIPAL_ID('website') IS NULL
    BEGIN
      DECLARE @sid varbinary(16) = CAST(CAST(${clientId} AS uniqueidentifier) AS varbinary(16));
      EXEC (N'CREATE USER [website] WITH SID = ' + CONVERT(nvarchar(64), @sid, 1) + N', TYPE = E');
    END;
    ALTER ROLE db_datareader ADD MEMBER [website];
    ALTER ROLE db_datawriter ADD MEMBER [website];
  `.execute(db);
}

/** Set once a preview is completely seeded; a run that failed halfway seeds again. */
const SEEDED_KEY = 'preview:seeded';

export async function isPreviewSeeded(db: Kysely<Database>): Promise<boolean> {
  const row = await db
    .selectFrom('nikolaus.state')
    .select('state_key')
    .where('state_key', '=', SEEDED_KEY)
    .executeTakeFirst();
  return row !== undefined;
}

export async function markPreviewSeeded(db: Kysely<Database>): Promise<void> {
  await db
    .insertInto('nikolaus.state')
    .values({ state_key: SEEDED_KEY, value: JSON.stringify({ at: new Date().toISOString() }) })
    .execute();
}

/** Test settings of a new preview: online booking and staff modules switched on. */
export async function enablePreviewSettings(db: Kysely<Database>): Promise<void> {
  await db
    .updateTable('nikolaus.settings')
    .set({ public_active: true, staff_active: true, maintenance: false, updated_by: 'preview' })
    .where('id', '=', 1)
    .execute();
}
