import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import {
  getCampflowEvents,
  getCampflowMembers,
  getCampflowMembersWithTime,
  holdsCampflowMembers,
  resetCampflowLoads,
} from '../lib/campflow';

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
function campflow(
  t: TestContext,
  answer: () => Response,
  timers: ('Date' | 'setTimeout')[] = ['Date']
): { count: number } {
  const token = process.env.CAMPFLOW_API_TOKEN;
  process.env.CAMPFLOW_API_TOKEN = 'test-token';
  t.after(() => {
    if (token === undefined) delete process.env.CAMPFLOW_API_TOKEN;
    else process.env.CAMPFLOW_API_TOKEN = token;
    resetCampflowLoads();
  });
  resetCampflowLoads();
  t.mock.timers.enable({ apis: timers, now: Date.parse('2026-10-21T10:00:00Z') });
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

test('a refresh of the member list asks CampFlow again and tells when', async (t) => {
  const calls = campflow(t, () => Response.json({ data: [{ id: 'per_1' }] }));

  const first = await getCampflowMembersWithTime();
  t.mock.timers.tick(10_000);
  const shared = await getCampflowMembers();
  const refreshed = await getCampflowMembersWithTime(true);

  assert.equal(calls.count, 2);
  assert.equal(shared, first.value);
  assert.equal(first.loadedAt.toISOString(), '2026-10-21T10:00:00.000Z');
  assert.equal(refreshed.loadedAt.toISOString(), '2026-10-21T10:00:10.000Z');
  // The other modules get the fresh list as well
  assert.equal(await getCampflowMembers(), refreshed.value);
});

test('the member list is dropped from memory a minute after it arrived', async (t) => {
  campflow(t, () => Response.json({ data: [{ id: 'per_1' }] }), ['Date', 'setTimeout']);

  await getCampflowMembers();
  // Let the success handler of the load run and arm its timer
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(holdsCampflowMembers(), true);
  t.mock.timers.tick(59_999);
  assert.equal(holdsCampflowMembers(), true);
  t.mock.timers.tick(1);
  assert.equal(holdsCampflowMembers(), false);
});
