import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import test, { after, before } from 'node:test';
import type { TestContext } from 'node:test';
import { sql } from 'kysely';
import { createDatabase, getDb, useDatabase } from '../../lib/db';
import type { DatabaseTarget } from '../../lib/db';
import { migrate, readMigrations } from '../../lib/db-migrations';

/**
 * Tests that use the database run against a real SQL Server, e.g. the container
 *
 *   docker run -d -p 1433:1433 -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='Test_Passw0rd!' \
 *     mcr.microsoft.com/mssql/server:2022-latest
 *
 * with `TEST_SQL_PASSWORD` (and optionally `TEST_SQL_SERVER`, `TEST_SQL_PORT`) set. Without it
 * they are skipped locally; in CI they are required.
 */
const password = process.env.TEST_SQL_PASSWORD;
if (!password && process.env.CI === 'true') {
  throw new Error('TEST_SQL_PASSWORD is required in CI: database tests must not be skipped');
}

export const SKIP = password ? false : 'TEST_SQL_PASSWORD is not set (no SQL Server for tests)';

/** The test SQL Server, connected to `database`. */
export function target(database: string): DatabaseTarget {
  return {
    server: process.env.TEST_SQL_SERVER ?? 'localhost',
    port: Number(process.env.TEST_SQL_PORT ?? 1433),
    database,
    trustServerCertificate: true,
    authentication: {
      type: 'default',
      options: { userName: process.env.TEST_SQL_USER ?? 'sa', password: password ?? '' },
    },
  };
}

let registered = false;

/**
 * Creates a database of its own for the test file (files run in parallel), applies the
 * migrations and drops it after the last test.
 */
function useTestDatabase(): void {
  if (registered || !password) return;
  registered = true;
  const name = `nikolaus_test_${process.pid}_${randomBytes(4).toString('hex')}`;
  let close: (() => Promise<void>) | undefined;
  before(async () => {
    const master = createDatabase(target('master'));
    try {
      await sql.raw(`CREATE DATABASE [${name}]`).execute(master);
    } finally {
      await master.destroy();
    }
    close = useDatabase(target(name));
    await migrate(getDb(), readMigrations(resolve(__dirname, '../../../migrations')));
  });
  after(async () => {
    await close?.();
    const master = createDatabase(target('master'));
    try {
      await sql
        .raw(
          `ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]`
        )
        .execute(master);
    } finally {
      await master.destroy();
    }
  });
}

/**
 * Deletes all data and puts the Nikolaus settings back to the values of the migration
 * (`fixtures/nikolaus-settings.ts`), so every test starts the same.
 */
export async function resetDatabase(): Promise<void> {
  await sql`
    DELETE FROM nikolaus.assignment;
    DELETE FROM nikolaus.dispo_visit;
    DELETE FROM nikolaus.helper_availability;
    DELETE FROM nikolaus.helper;
    DELETE FROM nikolaus.booking;
    DELETE FROM nikolaus.state;
    DELETE FROM nikolaus.audit_log;
    DELETE FROM content.faq;
    DELETE FROM content.blog_image;
    DELETE FROM content.blog_post;
    UPDATE nikolaus.settings SET
      public_active = 0, staff_active = 1, maintenance = 0, pending_hold_minutes = 120,
      change_deadline_hours = 24, base_name = N'Pfarrheim', base_latitude = 47.90885,
      base_longitude = 11.84664, service_postal_codes = N'["83620","83052"]',
      far_distance_km = 8, updated_by = N'';
    DELETE FROM nikolaus.day;
    INSERT INTO nikolaus.day (date, start_time, end_time, teams) VALUES
      ('2026-12-05', '17:00', '21:00', 2),
      ('2026-12-06', '17:00', '21:00', 3);
  `.execute(getDb());
}

/** A test that needs the database; it starts with empty tables. */
export function dbTest(name: string, fn: (t: TestContext) => Promise<void>): void {
  useTestDatabase();
  test(name, { skip: SKIP }, async (t) => {
    await resetDatabase();
    await fn(t);
  });
}
