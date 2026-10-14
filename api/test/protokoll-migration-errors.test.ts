import assert from 'node:assert/strict';
import test from 'node:test';
import { protokollMigrationFailure } from '../lib/protokoll-migration-errors';

test('operator errors explain the next step without exposing untrusted SDK diagnostics', () => {
  const sdkError = new Error('https://private.example/token?secret=credential protocol text');
  sdkError.name = 'credential';
  assert.deepEqual(protokollMigrationFailure(sdkError), {
    scope: 'protocol-migration',
    failed: true,
    reason: 'ACCESS_OR_OPERATION_FAILED_CHECK_GRAPH_AND_SQL',
  });
  assert.equal(
    protokollMigrationFailure(
      new Error('Source metadata changed or missing SQL copy: private-item-id')
    ).reason,
    'SOURCE_CHANGED_REIMPORT_WHILE_FROZEN'
  );
  assert.equal(
    protokollMigrationFailure(new Error('SQL_CHANGED_SINCE_IMPORT')).reason,
    'SQL_CHANGED_SINCE_IMPORT'
  );
});
