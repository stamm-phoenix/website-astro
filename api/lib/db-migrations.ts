import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { Kysely, RawBuilder } from 'kysely';
import type { Database } from './db-schema';

export interface Migration {
  name: string;
  checksum: string;
  /** Batches separated by `GO` lines, as in sqlcmd. */
  batches: string[];
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/** Reads `NNNN_name.sql` files in name order. */
export function readMigrations(directory: string): Migration[] {
  return readdirSync(directory)
    .filter((file) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(file))
    .sort()
    .map((file) => {
      const text = readFileSync(join(directory, file), 'utf8').replace(/\r\n/g, '\n');
      return {
        name: file,
        checksum: createHash('sha256').update(text).digest('hex'),
        batches: text
          .split(/^\s*GO\s*$/im)
          .map((batch) => batch.trim())
          .filter((batch) => batch.replace(/--.*$/gm, '').trim() !== ''),
      };
    });
}

/**
 * Runs the batches of one migration and records it in a single request instead of one round
 * trip per batch, which dominates on a fresh database (the CI runner is far from the server).
 * Each batch still compiles on its own, as with `GO`; the transaction is rolled back and the
 * original error thrown if one fails. Session settings are not touched, so a pooled connection
 * stays clean.
 */
export function migrationStatement(migration: Migration): RawBuilder<unknown> {
  const batches = migration.batches.map((batch) => sql`EXEC sp_executesql ${batch};`);
  return sql`
    BEGIN TRY
      BEGIN TRANSACTION;
      ${sql.join(batches, sql` `)}
      INSERT INTO dbo.schema_migrations (name, checksum)
        VALUES (${migration.name}, ${migration.checksum});
      COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
      THROW;
    END CATCH
  `;
}

/**
 * Applies all migrations that are not recorded in `dbo.schema_migrations`, each in its own
 * transaction (one request per migration). An application lock keeps two runs (e.g. two deployments) from overlapping.
 * An applied migration whose file changed afterwards stops the run: migrations are never
 * edited, a change needs a new file.
 */
export async function migrate(
  db: Kysely<Database>,
  migrations: Migration[],
  options: { dryRun?: boolean } = {}
): Promise<MigrationResult> {
  return db.connection().execute(async (connection) => {
    const lock = await sql<{ result: number }>`
      DECLARE @result int;
      EXEC @result = sp_getapplock
        @Resource = 'schema-migrations', @LockMode = 'Exclusive', @LockOwner = 'Session',
        @LockTimeout = 60000;
      SELECT @result AS result;
    `.execute(connection);
    if ((lock.rows[0]?.result ?? -1) < 0) throw new Error('Another migration is running');
    try {
      const exists = await sql<{ found: number }>`
        SELECT CASE WHEN OBJECT_ID('dbo.schema_migrations') IS NULL THEN 0 ELSE 1 END AS found
      `.execute(connection);
      // A dry run writes nothing, not even the bookkeeping table
      if (!exists.rows[0]?.found && !options.dryRun) {
        await sql`
          CREATE TABLE dbo.schema_migrations (
            name       nvarchar(200) NOT NULL CONSTRAINT pk_schema_migrations PRIMARY KEY,
            checksum   char(64)      NOT NULL,
            applied_at datetime2(0)  NOT NULL CONSTRAINT df_schema_migrations_applied_at
              DEFAULT SYSUTCDATETIME()
          );
        `.execute(connection);
      }
      const done = new Map(
        exists.rows[0]?.found || !options.dryRun
          ? (await connection.selectFrom('dbo.schema_migrations').selectAll().execute()).map(
              (row) => [row.name, row.checksum]
            )
          : []
      );
      const result: MigrationResult = { applied: [], skipped: [] };
      for (const migration of migrations) {
        const checksum = done.get(migration.name);
        if (checksum !== undefined) {
          if (checksum !== migration.checksum) {
            throw new Error(`Applied migration ${migration.name} was changed afterwards`);
          }
          result.skipped.push(migration.name);
          continue;
        }
        if (!options.dryRun) {
          await migrationStatement(migration).execute(connection);
        }
        result.applied.push(migration.name);
      }
      return result;
    } finally {
      // A failed release must not hide the migration error; closing the session frees it too
      await sql`EXEC sp_releaseapplock @Resource = 'schema-migrations', @LockOwner = 'Session'`
        .execute(connection)
        .catch(() => undefined);
    }
  });
}
