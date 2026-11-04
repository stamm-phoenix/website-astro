import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { StaffUsage } from '../endpoints/intern-haeufig';
import { getDb } from '../lib/db';
import { getStaffUsage, recordStaffUsage, pruneStaffUsage } from '../lib/staff-usage';
import { usageMonth } from '../lib/staff-usage-model';
import { validateStaffUsage } from '../lib/validation/staff-usage';
import { ValidationError } from '../lib/validation/errors';
import { dbTest } from './fixtures/database';

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
