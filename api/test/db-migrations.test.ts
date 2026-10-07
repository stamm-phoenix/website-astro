import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { getDb } from '../lib/db';
import { migrate, readMigrations } from '../lib/db-migrations';
import { dbTest } from './fixtures/database';

const DIRECTORY = resolve(__dirname, '../../migrations');

dbTest('applied migrations are skipped and a changed applied migration stops the run', async () => {
  const migrations = readMigrations(DIRECTORY);
  assert.ok(migrations.length > 0);
  assert.ok(migrations[0].batches.length > 1, 'GO separates batches');
  const again = await migrate(getDb(), migrations);
  assert.deepEqual(again.applied, []);
  assert.equal(again.skipped.length, migrations.length);
  await assert.rejects(
    migrate(getDb(), [{ ...migrations[0], checksum: '0'.repeat(64) }]),
    /was changed afterwards/
  );
});

dbTest('a new migration runs in a transaction and is recorded once', async () => {
  const added = {
    name: '9999_test.sql',
    checksum: '1'.repeat(64),
    batches: [
      'CREATE TABLE dbo.migration_test (id int)',
      'INSERT INTO dbo.migration_test VALUES (1)',
    ],
  };
  const broken = {
    ...added,
    name: '9998_broken.sql',
    batches: ['CREATE TABLE dbo.half (id int)', 'SELECT * FROM missing_table'],
  };
  try {
    await assert.rejects(migrate(getDb(), [broken]));
    const first = await migrate(getDb(), [added]);
    assert.deepEqual(first.applied, ['9999_test.sql']);
    assert.deepEqual((await migrate(getDb(), [added])).applied, []);
    const tables = await getDb()
      .selectFrom('dbo.schema_migrations')
      .select('name')
      .where('name', 'in', ['9998_broken.sql', '9999_test.sql'])
      .execute();
    assert.deepEqual(
      tables.map((row) => row.name),
      ['9999_test.sql']
    );
  } finally {
    await getDb().deleteFrom('dbo.schema_migrations').where('name', '=', '9999_test.sql').execute();
    await getDb().schema.dropTable('dbo.migration_test').ifExists().execute();
    await getDb().schema.dropTable('dbo.half').ifExists().execute();
  }
});
