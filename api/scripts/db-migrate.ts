/**
 * Applies the SQL migrations in `api/migrations` to the database in `CONFIG.database`.
 * Signs in with the Azure CLI (`az login` locally, `azure/login` in the workflow); that identity
 * needs DDL rights. The website itself only reads and writes data.
 *
 *   bun scripts/db-migrate.ts [--dry-run]
 */
import { resolve } from 'node:path';
import { AzureCliCredential } from '@azure/identity';
import { CONFIG } from '../lib/config';
import { createDatabase, getSqlErrorNumber } from '../lib/db';
import { migrate, readMigrations } from '../lib/db-migrations';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--dry-run', '--help'].includes(arg))) {
    throw new Error('Usage: bun scripts/db-migrate.ts [--dry-run]');
  }
  if (args.includes('--help')) {
    console.log('Usage: bun scripts/db-migrate.ts [--dry-run]');
    return;
  }
  const db = createDatabase({
    server: CONFIG.database.server,
    database: CONFIG.database.name,
    authentication: {
      type: 'token-credential',
      options: { credential: new AzureCliCredential() },
    },
  });
  try {
    const result = await migrate(db, readMigrations(resolve(__dirname, '../migrations')), {
      dryRun: args.includes('--dry-run'),
    });
    console.log(
      JSON.stringify({
        scope: 'db_migrate',
        database: `${CONFIG.database.server}/${CONFIG.database.name}`,
        dryRun: args.includes('--dry-run'),
        applied: result.applied,
        alreadyApplied: result.skipped.length,
      })
    );
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      scope: 'db_migrate',
      status: 'failed',
      errorNumber: getSqlErrorNumber(error) ?? null,
      message: error instanceof Error ? error.message : String(error),
    })
  );
  process.exitCode = 1;
});
