import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createResourceMap } from '../src/lib/resourceMap.svelte';
import { gate, json, stubFetch } from './fixtures/fetch-stub';

/** The same guarantees as `createResource`, per key. */

let stub: ReturnType<typeof stubFetch> | null = null;
afterEach(() => stub?.restore());

function items() {
  return createResourceMap<{ path: string }>((key) => `/x/${key}`, { refreshable: true });
}

test('keys load independently and a load of one key never aborts another', async () => {
  const offen = gate();
  stub = stubFetch(async ({ path }) => {
    if (path === '/x/a') await offen.promise;
    return json({ path });
  });
  const map = items();
  const a = map.load('a');
  await map.load('b');
  assert.equal(stub.calls[0].signal?.aborted, false);
  assert.equal(map.state.b.data?.path, '/x/b');
  assert.equal(map.state.a.loading, true);
  offen.open();
  await a;
  assert.equal(map.state.a.data?.path, '/x/a');
  assert.equal(map.state.a.loading, false);
});

test('a key is cached, joined while running and forced on request', async () => {
  const offen = gate();
  stub = stubFetch(async () => {
    await offen.promise;
    return json({ path: '' });
  });
  const map = items();
  const first = map.load('a');
  assert.equal(map.load('a'), first);
  assert.notEqual(map.load('a', { force: true }), first);
  offen.open();
  await first;
  await map.load('a');
  assert.equal(stub.calls.length, 2);
});

test('the newest load of a key wins over a late older answer', async () => {
  const alt = gate();
  let calls = 0;
  stub = stubFetch(async () => {
    if (++calls === 1) {
      await alt.promise;
      return json({ path: 'alt' });
    }
    return json({ path: 'neu' });
  });
  const map = items();
  const first = map.load('a');
  const second = map.load('a', { force: true });
  await second;
  alt.open();
  await first;
  assert.equal(map.state.a.data?.path, 'neu');
  assert.equal(map.state.a.loading, false);
});

test('set after a write beats an in-flight load of the same key only', async () => {
  const offen = gate();
  stub = stubFetch(async ({ path }) => {
    await offen.promise;
    return json({ path });
  });
  const map = items();
  const a = map.load('a');
  const b = map.load('b');
  map.set('a', { path: 'geschrieben' });
  offen.open();
  await Promise.all([a, b]);
  assert.equal(map.state.a.data?.path, 'geschrieben');
  assert.equal(map.state.b.data?.path, '/x/b');
});

test('invalidate marks one key or all keys as outdated', async () => {
  stub = stubFetch(async ({ path }) => json({ path }));
  const map = items();
  await map.load('a');
  await map.load('b');
  map.invalidate('a');
  assert.equal(map.isCurrent('a'), false);
  assert.equal(map.isCurrent('b'), true);
  await map.load('a');
  await map.load('b');
  assert.equal(stub.calls.length, 3);
  map.invalidate();
  await map.load('a');
  await map.load('b');
  assert.equal(stub.calls.length, 5);
  assert.equal(map.isCurrent('unbekannt'), false);
});

test('refresh asks for a new read of one key and keeps the plain key cached', async () => {
  stub = stubFetch(async ({ path }) => json({ path }));
  const map = items();
  await map.refresh('a');
  assert.equal(stub.calls[0].path, '/x/a?refresh=true');
  await map.load('a');
  assert.equal(stub.calls.length, 1);
});

test('forget drops every key, also one whose load is still running', async () => {
  const offen = gate();
  stub = stubFetch(async () => {
    await offen.promise;
    return json({ path: 'x' });
  });
  const map = items();
  const running = map.load('a');
  map.forget();
  assert.deepEqual(Object.keys(map.state), []);
  offen.open();
  await running;
  assert.deepEqual(Object.keys(map.state), []);
  await map.load('a');
  assert.equal(map.state.a.data?.path, 'x');
});

test('keyOf names the entry, so a key like __proto__ is an ordinary entry', async () => {
  stub = stubFetch(async ({ path }) => json({ path }));
  const map = createResourceMap<{ path: string }>((key) => `/x/${key}`, {
    keyOf: (key) => `/${key}`,
  });
  await map.load('__proto__');
  assert.equal(map.state['/__proto__'].data?.path, '/x/__proto__');
  assert.equal(Object.getPrototypeOf(map.state), Object.prototype);
});
