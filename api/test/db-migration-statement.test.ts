import assert from 'node:assert/strict';
import test from 'node:test';
import { DummyDriver, Kysely, MssqlAdapter, MssqlIntrospector, MssqlQueryCompiler } from 'kysely';
import { migrationStatement } from '../lib/db-migrations';
import type { Migration } from '../lib/db-migrations';

const db = new Kysely<Record<string, never>>({
  dialect: {
    createAdapter: () => new MssqlAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new MssqlIntrospector(kysely),
    createQueryCompiler: () => new MssqlQueryCompiler(),
  },
});

const migration: Migration = {
  name: '0001_test.sql',
  checksum: 'a'.repeat(64),
  batches: [
    "CREATE TABLE dbo.t (id int, note nvarchar(10) DEFAULT 'it''s')",
    'CREATE VIEW dbo.v AS SELECT 1 AS x',
  ],
};

test('a migration is one request with every batch as its own parameter', () => {
  const compiled = migrationStatement(migration).compile(db);
  // The batches are passed as parameters, so no quote of the file has to be escaped
  assert.deepEqual(compiled.parameters, [...migration.batches, migration.name, migration.checksum]);
  assert.equal(compiled.sql.match(/EXEC sp_executesql @\d/g)?.length, 2);
  assert.doesNotMatch(compiled.sql, /CREATE TABLE|CREATE VIEW/);
});

test('a migration is recorded inside its transaction and rolled back with the original error', () => {
  const { sql } = migrationStatement(migration).compile(db);
  const order = [
    'BEGIN TRY',
    'BEGIN TRANSACTION',
    'sp_executesql',
    'INSERT INTO dbo.schema_migrations',
    'COMMIT TRANSACTION',
    'BEGIN CATCH',
    'ROLLBACK TRANSACTION',
    'THROW',
  ];
  let position = -1;
  for (const part of order) {
    const found = sql.indexOf(part, position + 1);
    assert.ok(found > position, `${part} after the previous part`);
    position = found;
  }
  assert.doesNotMatch(sql, /XACT_ABORT/, 'pooled connections keep their session settings');
});
