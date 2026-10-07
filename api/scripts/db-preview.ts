/**
 * The database of a PR preview (`website-pr-<number>`), so previews never use the production
 * data. Runs in the deploy workflow with the identity `website-astro-previews`, which may only
 * create databases and owns the ones it created (role `dbmanager` in `master`,
 * `docs/azure-sql.md`). Signs in with the Azure CLI.
 *
 *   bun scripts/db-preview.ts create <PR> [--write-deployment]
 *       creates the database if needed, applies the migrations, lets the website in and fills a
 *       new database with test data; --write-deployment points this deployment at it
 *   bun scripts/db-preview.ts drop <PR>
 *   bun scripts/db-preview.ts grant-creator <client ID>
 *       one-time setup, run by a database admin: lets the identity create databases
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import { AzureCliCredential } from '@azure/identity';
import { CONFIG } from '../lib/config';
import { closeDatabase, createDatabase, getDb, getSqlErrorNumber, useDatabase } from '../lib/db';
import type { DatabaseTarget } from '../lib/db';
import { migrate, readMigrations } from '../lib/db-migrations';
import {
  createPreviewDatabase,
  dropPreviewDatabase,
  enablePreviewSettings,
  grantWebsiteAccess,
  isPreviewSeeded,
  markPreviewSeeded,
  previewDatabaseName,
  seedPreviewPlans,
} from '../lib/db-preview';
import { createTestData, createTestHelpers } from './nikolaus-testdata';

const USAGE =
  'Usage: bun scripts/db-preview.ts create <PR> [--write-deployment] | drop <PR> | grant-creator <client ID>';

// Creating or dropping a database in Azure SQL can take minutes
const MASTER_TIMEOUT_MS = 10 * 60_000;

function target(database: string): DatabaseTarget {
  return {
    server: CONFIG.database.server,
    database,
    ...(database === 'master' ? { requestTimeout: MASTER_TIMEOUT_MS } : {}),
    authentication: {
      type: 'token-credential',
      options: { credential: new AzureCliCredential() },
    },
  };
}

function log(values: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: 'db_preview', ...values }));
}

async function create(pr: string, writeDeployment: boolean): Promise<void> {
  const name = previewDatabaseName(pr);
  const master = createDatabase(target('master'));
  let created: boolean;
  try {
    created = await createPreviewDatabase(master, name, { azure: true });
  } finally {
    await master.destroy();
  }

  const db = createDatabase(target(name));
  let seeded: boolean;
  try {
    await grantWebsiteAccess(db, CONFIG.azure.clientId);
    const result = await migrate(db, readMigrations(resolve(__dirname, '../migrations')));
    seeded = await isPreviewSeeded(db);
    log({ database: name, created, seeded, applied: result.applied });
  } finally {
    await db.destroy();
  }

  // A new preview starts with invented families, helpers and the suggested Einteilung and
  // Dispo; later pushes keep what reviewers did. The mark comes last, so a run that failed
  // halfway seeds again (every step only fills what is missing).
  if (!seeded) {
    useDatabase(target(name));
    try {
      const preview = getDb();
      await enablePreviewSettings(preview);
      await createTestData(false, null);
      await createTestHelpers(false, true);
      await seedPreviewPlans();
      await markPreviewSeeded(preview);
    } finally {
      // An open pool would keep the job running after an error
      await closeDatabase();
    }
  }

  if (writeDeployment) {
    writeFileSync(
      resolve(__dirname, '../lib/deployment.ts'),
      `// Written by scripts/db-preview.ts for the preview of PR ${pr}\nexport const PREVIEW_DATABASE: string | null = '${name}';\n`
    );
  }
}

async function drop(pr: string): Promise<void> {
  const name = previewDatabaseName(pr);
  const master = createDatabase(target('master'));
  try {
    log({ database: name, dropped: await dropPreviewDatabase(master, name) });
  } finally {
    await master.destroy();
  }
}

/** One-time setup by a database admin (member of the admin group, signed in with `az login`). */
async function grantCreator(clientId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new Error('Invalid client ID');
  }
  const master = createDatabase(target('master'));
  try {
    await sql`
      IF DATABASE_PRINCIPAL_ID('website-astro-previews') IS NULL
      BEGIN
        DECLARE @sid varbinary(16) = CAST(CAST(${clientId} AS uniqueidentifier) AS varbinary(16));
        -- EXEC (…) takes only strings and variables, no function calls
        DECLARE @create nvarchar(200) = N'CREATE USER [website-astro-previews] WITH SID = '
          + CONVERT(nvarchar(64), @sid, 1) + N', TYPE = E';
        EXEC (@create);
      END;
      ALTER ROLE dbmanager ADD MEMBER [website-astro-previews];
    `.execute(master);
    log({ granted: 'dbmanager', user: 'website-astro-previews' });
  } finally {
    await master.destroy();
  }
}

async function main(): Promise<void> {
  const [command, value, ...rest] = process.argv.slice(2);
  if (command === 'create' && value && rest.every((arg) => arg === '--write-deployment')) {
    await create(value, rest.includes('--write-deployment'));
  } else if (command === 'drop' && value && rest.length === 0) {
    await drop(value);
  } else if (command === 'grant-creator' && value && rest.length === 0) {
    await grantCreator(value);
  } else {
    throw new Error(USAGE);
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      scope: 'db_preview',
      status: 'failed',
      errorNumber: getSqlErrorNumber(error) ?? null,
      message: error instanceof Error ? error.message : String(error),
    })
  );
  process.exitCode = 1;
});
