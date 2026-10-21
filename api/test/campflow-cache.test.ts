import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { getCampflowEvents, getCampflowMembers, resetCampflowLoads } from '../lib/campflow';

const EVENT = {
  id: 'evt_Sola',
  title: 'Sommerlager',
  published: true,
  start_date: '2026-08-01',
  end_date: '2026-08-10',
  max_persons: null,
  archived: false,
  url: null,
  collection: null,
  embed_snippet: '<iframe></iframe>',
};

/** Answers every CampFlow request with `answer`; returns how many requests were sent. */
function campflow(t: TestContext, answer: () => Response): { count: number } {
  const token = process.env.CAMPFLOW_API_TOKEN;
  process.env.CAMPFLOW_API_TOKEN = 'test-token';
  t.after(() => {
    if (token === undefined) delete process.env.CAMPFLOW_API_TOKEN;
    else process.env.CAMPFLOW_API_TOKEN = token;
    resetCampflowLoads();
  });
  resetCampflowLoads();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-21T10:00:00Z') });
  const calls = { count: 0 };
  t.mock.method(globalThis, 'fetch', async () => {
    calls.count++;
    return answer();
  });
  return calls;
}

test('requests within a minute share one load of the CampFlow events', async (t) => {
  const calls = campflow(t, () => Response.json({ data: [{ ...EVENT }] }));

  const [first, second] = await Promise.all([getCampflowEvents(), getCampflowEvents()]);
  t.mock.timers.tick(59_000);
  const later = await getCampflowEvents();

  assert.equal(calls.count, 1);
  assert.equal(first, second);
  assert.equal(later, first);
  assert.deepEqual(
    first.map((event) => [event.id, event.embed_snippet]),
    [['evt_Sola', undefined]]
  );
});

test('the CampFlow events are loaded again after a minute', async (t) => {
  const calls = campflow(t, () => Response.json({ data: [{ ...EVENT }] }));

  await getCampflowEvents();
  t.mock.timers.tick(60_000);
  await getCampflowEvents();

  assert.equal(calls.count, 2);
});

test('a failed load of the CampFlow events is not reused', async (t) => {
  let fail = true;
  const calls = campflow(t, () =>
    fail ? new Response('down', { status: 503 }) : Response.json({ data: [{ ...EVENT }] })
  );

  await assert.rejects(getCampflowEvents(), { status: 503 });
  fail = false;
  const events = await getCampflowEvents();

  assert.equal(calls.count, 2);
  assert.deepEqual(
    events.map((event) => event.id),
    ['evt_Sola']
  );
});

test('the member list is shared like the events, apart from them', async (t) => {
  const calls = campflow(t, () => Response.json({ data: [{ id: 'prs_1' }] }));

  const [first, second] = await Promise.all([getCampflowMembers(), getCampflowMembers()]);
  await getCampflowEvents();

  assert.equal(calls.count, 2);
  assert.equal(first, second);
  assert.deepEqual(
    first.map((person) => person.id),
    ['prs_1']
  );
});

test('a load still running after a minute is shared, the minute counts from its answer', async (t) => {
  let answer = (): void => undefined;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  const calls = campflow(t, () => Response.json({ data: [{ ...EVENT }] }));
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (...args: Parameters<typeof fetch>) => {
    await answered;
    return fetch(...args);
  });

  const first = getCampflowEvents();
  t.mock.timers.tick(90_000);
  const during = getCampflowEvents();
  answer();
  await Promise.all([first, during]);
  t.mock.timers.tick(59_000);
  await getCampflowEvents();

  assert.equal(during, first);
  assert.equal(calls.count, 1);
});
