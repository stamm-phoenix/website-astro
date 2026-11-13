import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { StaffUsage } from '../endpoints/intern-haeufig';
import { getDb } from '../lib/db';
import {
  getStaffUsage,
  pruneStaffUsage,
  recordStaffUsage,
  resetStaffUsagePruning,
} from '../lib/staff-usage';
import { usageMonth } from '../lib/staff-usage-model';
import { validateStaffUsage } from '../lib/validation/staff-usage';
import { ValidationError } from '../lib/validation/errors';
import { dbTest } from './fixtures/database';
import { recordQueries } from './fixtures/queries';

const NOW = new Date('2026-01-15T12:00:00Z');
test('month windows cross the year boundary', () => {
  assert.equal(usageMonth(NOW), '2026-01');
  assert.equal(usageMonth(NOW, -2), '2025-11');
  assert.equal(usageMonth(NOW, -3), '2025-10');
});
test('only known module paths can create counters; errors address the module field', () => {
  assert.equal(
    validateStaffUsage({ module: '/leitendenbereich/belege' }),
    '/leitendenbereich/belege'
  );
  for (const module of [
    '/leitendenbereich/arbitrary',
    '/blog',
    '/leitendenbereich/belege/123',
    null,
    12,
  ]) {
    assert.throws(
      () => validateStaffUsage({ module }),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.fields.module, 'Der Bereich ist ungültig.');
        return true;
      }
    );
  }
});
dbTest('concurrent visits increment one anonymous monthly total without lost updates', async () => {
  await Promise.all(
    Array.from({ length: 8 }, () => recordStaffUsage('/leitendenbereich/belege', NOW))
  );
  assert.deepEqual(await getStaffUsage(NOW), { '/leitendenbereich/belege': 8 });
  const rows = await getDb().selectFrom('organisation.staff_usage').selectAll().execute();
  assert.deepEqual(rows, [{ month: '2026-01', module: '/leitendenbereich/belege', visits: 8 }]);
});
dbTest('ranking uses three months and cleanup retains no more than four', async () => {
  for (const month of ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']) {
    await getDb()
      .insertInto('organisation.staff_usage')
      .values({ month, module: '/leitendenbereich/belege', visits: 10 })
      .execute();
  }
  assert.deepEqual(await getStaffUsage(NOW), { '/leitendenbereich/belege': 30 });
  await pruneStaffUsage(NOW);
  const rows = await getDb()
    .selectFrom('organisation.staff_usage')
    .select('month')
    .orderBy('month')
    .execute();
  assert.deepEqual(
    rows.map((row) => row.month),
    ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02']
  );
});

const BELEGE = '/leitendenbereich/belege';

dbTest('the first visit of a month creates the counter and later visits count up', async () => {
  resetStaffUsagePruning();
  await recordStaffUsage(BELEGE, NOW);
  await recordStaffUsage(BELEGE, NOW);
  await recordStaffUsage('/leitendenbereich/aufgaben', NOW);
  await recordStaffUsage(BELEGE, new Date('2026-02-01T00:00:00Z'));
  const rows = await getDb()
    .selectFrom('organisation.staff_usage')
    .selectAll()
    .orderBy('month')
    .orderBy('module')
    .execute();
  assert.deepEqual(rows, [
    { month: '2026-01', module: '/leitendenbereich/aufgaben', visits: 1 },
    { month: '2026-01', module: BELEGE, visits: 2 },
    { month: '2026-02', module: BELEGE, visits: 1 },
  ]);
});

dbTest('concurrent first visits do not lose a count to the primary key', async () => {
  resetStaffUsagePruning();
  await Promise.all(Array.from({ length: 12 }, () => recordStaffUsage(BELEGE, NOW)));
  assert.deepEqual(await getStaffUsage(NOW), { [BELEGE]: 12 });
});

dbTest('a counted visit is one statement without a delete or a lock', async (t) => {
  resetStaffUsagePruning();
  await recordStaffUsage(BELEGE, NOW);
  const log = recordQueries(t);
  await recordStaffUsage(BELEGE, NOW);
  assert.equal(log.statements.length, 1);
  assert.match(log.statements[0], /^update /i);
  await getStaffUsage(NOW);
  assert.equal(log.statements.length, 2);
  assert.match(log.statements[1], /^select /i);
});

dbTest(
  'old months go with the first visit of a day on an instance, not with every request',
  async () => {
    resetStaffUsagePruning();
    const insertOld = async (): Promise<void> => {
      await getDb()
        .insertInto('organisation.staff_usage')
        .values({ month: '2025-09', module: BELEGE, visits: 4 })
        .execute();
    };
    const months = async (): Promise<string[]> =>
      (
        await getDb()
          .selectFrom('organisation.staff_usage')
          .select('month')
          .orderBy('month')
          .execute()
      ).map((row) => row.month);
    await insertOld();
    await getStaffUsage(NOW);
    assert.deepEqual(await months(), ['2025-09']);
    await recordStaffUsage(BELEGE, NOW);
    assert.deepEqual(await months(), ['2026-01']);
    await insertOld();
    await recordStaffUsage(BELEGE, NOW);
    assert.deepEqual(await months(), ['2025-09', '2026-01']);
    await recordStaffUsage(BELEGE, new Date('2026-01-16T12:00:00Z'));
    assert.deepEqual(await months(), ['2026-01']);
  }
);

test('anonymous and non-staff requests cannot read or change totals', async () => {
  for (const principal of [
    null,
    {
      identityProvider: 'aad',
      userId: 'outsider',
      userDetails: 'outside@example.test',
      userRoles: ['authenticated'],
    },
  ]) {
    for (const method of ['GET', 'POST']) {
      const headers: Record<string, string> = {};
      if (principal)
        headers['x-ms-client-principal'] = Buffer.from(JSON.stringify(principal)).toString(
          'base64'
        );
      const response = await StaffUsage(
        new HttpRequest({ url: 'http://localhost/api/intern/haeufig', method, headers }),
        new InvocationContext()
      );
      assert.ok(response.status === 401 || response.status === 403);
    }
  }
});
