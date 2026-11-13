import assert from 'node:assert/strict';
import { insertTaskRows } from '../lib/aufgaben-batch';
import { getDb, inTransaction } from '../lib/db';
import { dbTest } from './fixtures/database';

dbTest('tasks are inserted in slices and keep their order', async () => {
  const count = 250;
  await inTransaction((trx) =>
    insertTaskRows(
      trx,
      Array.from({ length: count }, (_, index) => ({
        title: `Aufgabe ${index}`,
        description: '',
        assignee: '',
        assignees: '[]',
        due_date: null,
        project_id: null,
        updated_by: 'test@example.test',
        state: 'offen' as const,
      }))
    )
  );
  await inTransaction((trx) => insertTaskRows(trx, []));

  const rows = await getDb()
    .selectFrom('organisation.task')
    .select('title')
    .orderBy('id')
    .execute();
  assert.deepEqual(
    rows.map((row) => row.title),
    Array.from({ length: count }, (_, index) => `Aufgabe ${index}`)
  );
});
