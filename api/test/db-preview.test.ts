import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import { sql } from 'kysely';
import { createDatabase } from '../lib/db';
import { migrate, readMigrations } from '../lib/db-migrations';
import {
  createPreviewDatabase,
  databaseExists,
  dropPreviewDatabase,
  enablePreviewSettings,
  grantWebsiteAccess,
  isPreviewSeeded,
  markPreviewSeeded,
  previewDatabaseName,
} from '../lib/db-preview';
import { loadNikolausSettings } from '../lib/nikolaus-settings';
import { SKIP, target } from './fixtures/database';

test('preview databases are named after the PR number only', () => {
  assert.equal(previewDatabaseName(226), 'website-pr-226');
  assert.equal(previewDatabaseName('7'), 'website-pr-7');
  for (const invalid of ['0', '01', '-1', '226; DROP DATABASE website', 'abc', '1234567', ''])
    assert.throws(() => previewDatabaseName(invalid), /Invalid pull request number/);
});

test(
  'a preview database is created once, migrated, switched on and dropped',
  { skip: SKIP },
  async () => {
    // Several test runs may share the server
    const name = previewDatabaseName(900_000 + randomInt(99_999));
    const master = createDatabase(target('master'));
    try {
      const sleep = async (): Promise<void> => undefined;
      assert.equal(await createPreviewDatabase(master, name, { azure: false, sleep }), true);
      assert.equal(await createPreviewDatabase(master, name, { azure: false, sleep }), false);
      assert.equal(await databaseExists(master, name), true);
      await assert.rejects(
        createPreviewDatabase(master, 'website', { azure: false, sleep }),
        /Not a preview database/
      );

      const db = createDatabase(target(name));
      try {
        await migrate(db, readMigrations(resolve(__dirname, '../../migrations')));
        assert.equal(await isPreviewSeeded(db), false);

        // Users from Entra ID (TYPE = E) only exist in Azure SQL; with an existing user the whole
        // statement must still compile and only add the roles, also when run again
        await sql`CREATE USER [website] WITHOUT LOGIN`.execute(db);
        const clientId = 'bda046a0-c3a8-46bf-84c6-624597e360d0';
        await grantWebsiteAccess(db, clientId);
        await grantWebsiteAccess(db, clientId);
        const roles = await sql<{ role: string }>`
          SELECT r.name AS role FROM sys.database_role_members rm
          JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
          JOIN sys.database_principals m ON m.principal_id = rm.member_principal_id
          WHERE m.name = 'website' ORDER BY r.name
        `.execute(db);
        assert.deepEqual(
          roles.rows.map((row) => row.role),
          ['db_datareader', 'db_datawriter']
        );
        await assert.rejects(grantWebsiteAccess(db, 'website'), /Invalid client ID/);
        await enablePreviewSettings(db);
        await markPreviewSeeded(db);
        assert.equal(await isPreviewSeeded(db), true);
        const { settings, updatedBy } = await loadNikolausSettings(db);
        assert.equal(settings.publicActive, true);
        assert.equal(settings.staffActive, true);
        assert.equal(updatedBy, 'preview');
      } finally {
        await db.destroy();
      }

      assert.equal(await dropPreviewDatabase(master, name), true);
      assert.equal(await dropPreviewDatabase(master, name), false);
      await assert.rejects(dropPreviewDatabase(master, 'website'), /Not a preview database/);
    } finally {
      await dropPreviewDatabase(master, name).catch(() => undefined);
      await master.destroy();
    }
  }
);
