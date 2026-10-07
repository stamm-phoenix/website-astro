import assert from 'node:assert/strict';
import { sql } from 'kysely';
import { getDb, inTransaction } from '../lib/db';
import {
  InvalidNikolausStateError,
  NikolausStateConflictError,
  deleteNikolausState,
  listNikolausStates,
  mutateNikolausState,
  readNikolausState,
} from '../lib/nikolaus-state';
import { dbTest } from './fixtures/database';

interface Counter {
  n: number;
}

const counter = (value: unknown): Counter => (value as Counter | undefined) ?? { n: 0 };
const set = (n: number) => (): Counter => ({ n });

dbTest('concurrent changes of one document run one after the other', async () => {
  await Promise.all(
    Array.from({ length: 12 }, () =>
      mutateNikolausState('test:counter', counter, ({ n }) => ({ n: n + 1 }))
    )
  );
  assert.deepEqual((await readNikolausState('test:counter'))?.data, { n: 12 });
});

dbTest('an unchanged document is not written and an aborted change leaves it intact', async () => {
  await mutateNikolausState('test:value', counter, set(1));
  const before = (await readNikolausState('test:value'))!.version;
  assert.equal(await mutateNikolausState('test:value', counter, () => undefined), undefined);
  assert.deepEqual(await mutateNikolausState('test:value', counter, set(1)), { n: 1 });
  assert.equal((await readNikolausState('test:value'))!.version, before);
  await assert.rejects(
    mutateNikolausState('test:value', counter, () => {
      throw new NikolausStateConflictError();
    }),
    NikolausStateConflictError
  );
  assert.deepEqual((await readNikolausState('test:value'))?.data, { n: 1 });
});

dbTest('changes inside a transaction roll back with it', async () => {
  await assert.rejects(
    inTransaction(async (trx) => {
      await mutateNikolausState('test:rollback', counter, set(5), trx);
      throw new Error('Abort');
    }),
    /Abort/
  );
  assert.equal(await readNikolausState('test:rollback'), undefined);
});

dbTest('prefix listing is literal and invalid keys are refused', async () => {
  await mutateNikolausState('retention:schedule:2026', counter, set(1));
  await mutateNikolausState('retention_schedule:2026', counter, set(2));
  assert.deepEqual(
    (await listNikolausStates('retention:')).map((state) => state.key),
    ['retention:schedule:2026']
  );
  assert.deepEqual(
    (await listNikolausStates('retention_')).map((state) => state.key),
    ['retention_schedule:2026']
  );
  await assert.rejects(readNikolausState("x' OR 1=1"), /Invalid Nikolaus state key/);
  await deleteNikolausState('retention_schedule:2026');
  assert.equal((await listNikolausStates('')).length, 1);
});

dbTest('the database refuses documents that are not JSON', async () => {
  await assert.rejects(
    sql`INSERT INTO nikolaus.state (state_key, value) VALUES ('test:broken', 'not json')`.execute(
      getDb()
    ),
    /ck_state_value/
  );
  assert.equal(InvalidNikolausStateError.name, 'InvalidNikolausStateError');
});
