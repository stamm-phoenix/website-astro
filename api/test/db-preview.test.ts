import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import { createDatabase } from '../lib/db';
import { migrate, readMigrations } from '../lib/db-migrations';
import {
  createPreviewDatabase,
  databaseExists,
  dropPreviewDatabase,
  enablePreviewSettings,
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
