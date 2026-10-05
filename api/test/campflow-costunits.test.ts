import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import * as env from '../lib/environment';
import { CONFIG } from '../lib/config';
import { ensureCampflowExpenseAssignment, PlaywrightApiError } from '../lib/playwright-api';

const CATEGORY = { name: 'Bestellungen', sphere: 'business' };
const UNIT = { id: 'cun_Test', name: 'Frühjahr / 2027', archived: false, categories: [CATEGORY] };

/** Simulate only the documented Playwright service; never call CampFlow in these tests. */
function setup(t: TestContext, responses: Response[]): { path: string; body?: unknown }[] {
  t.mock.method(env, 'getEnvironment', () => 'test-key');
  const calls: { path: string; body?: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, new URL(CONFIG.playwrightApi.url).origin);
    assert.equal((init.headers as Record<string, string>)['x-api-key'], 'test-key');
    assert.equal(init.redirect, 'error');
    assert.equal(init.method ?? 'GET', init.body ? 'PUT' : 'GET');
    calls.push({
      path: url.pathname,
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    const response = responses.shift();
    assert.ok(response, 'No unexpected extra request or automatic retry');
    return response;
  });
  return calls;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

test('existing category is reused without writes or changing its sphere', async (t) => {
  const calls = setup(t, [
    json({ data: [{ ...UNIT, categories: [{ ...CATEGORY, sphere: 'ideal' }] }] }),
  ]);
  await ensureCampflowExpenseAssignment(UNIT.name, CATEGORY.name, 'business');
  assert.deepEqual(calls, [{ path: '/campflow/kostenstellen' }]);
});

test('missing cost centre is created together with its category', async (t) => {
  const calls = setup(t, [json({ data: [] }), json(UNIT, 201)]);
  await ensureCampflowExpenseAssignment(UNIT.name, CATEGORY.name, 'business');
  assert.deepEqual(calls, [
    { path: '/campflow/kostenstellen' },
    { path: '/campflow/kostenstellen', body: { name: UNIT.name, categories: [CATEGORY] } },
  ]);
});

test('missing category is added by cost centre ID without replacing existing categories', async (t) => {
  const calls = setup(t, [json({ data: [{ ...UNIT, categories: [] }] }), json(UNIT, 201)]);
  await ensureCampflowExpenseAssignment(UNIT.name, CATEGORY.name, 'business');
  assert.deepEqual(calls[1], {
    path: '/campflow/kostenstellen/cun_Test/kategorien',
    body: CATEGORY,
  });
});

test('concurrent centre creation is read back and a missing category is then added', async (t) => {
  const calls = setup(t, [
    json({ data: [] }),
    json({}, 409),
    json({ data: [{ ...UNIT, categories: [] }] }),
    json(UNIT, 201),
  ]);
  await ensureCampflowExpenseAssignment(UNIT.name, CATEGORY.name, 'business');
  assert.equal(calls.length, 4);
  assert.equal(
    calls.filter((call) => call.path === '/campflow/kostenstellen' && call.body).length,
    1
  );
});

test('concurrent category creation is accepted only after confirming its presence', async (t) => {
  const calls = setup(t, [
    json({ data: [{ ...UNIT, categories: [] }] }),
    json({}, 409),
    json({ data: [UNIT] }),
  ]);
  await ensureCampflowExpenseAssignment(UNIT.name, CATEGORY.name, 'business');
  assert.equal(calls.length, 3);
});

test('archived centres block contribution setup without any write', async (t) => {
  const calls = setup(t, [json({ data: [{ ...UNIT, archived: true }] })]);
  await assert.rejects(
    ensureCampflowExpenseAssignment(UNIT.name, CATEGORY.name, 'business'),
    (error: unknown) => error instanceof PlaywrightApiError && error.status === 409
  );
  assert.equal(calls.length, 1);
});

test('failed or unconfirmed writes are not retried or accepted', async (t) => {
  for (const response of [
    json({}, 502),
    json({ ...UNIT, categories: [] }, 201),
    json({ ...UNIT, name: 'Other' }, 201),
  ]) {
    const calls = setup(t, [json({ data: [{ ...UNIT, categories: [] }] }), response]);
    await assert.rejects(
      ensureCampflowExpenseAssignment(UNIT.name, CATEGORY.name, 'business'),
      PlaywrightApiError
    );
    assert.equal(calls.length, 2);
  }
});

test('malformed mappings fail closed before writes', async (t) => {
  const calls = setup(t, [json({ data: [{ ...UNIT, categories: null }] })]);
  await assert.rejects(
    ensureCampflowExpenseAssignment(UNIT.name, CATEGORY.name, 'business'),
    PlaywrightApiError
  );
  assert.equal(calls.length, 1);
});
