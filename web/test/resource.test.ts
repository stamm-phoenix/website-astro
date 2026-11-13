import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createResource } from '../src/lib/resource.svelte';
import { gate, json, stubFetch } from './fixtures/fetch-stub';

/** The loading rules every store built on `createResource` relies on. */

let stub: ReturnType<typeof stubFetch> | null = null;
afterEach(() => stub?.restore());

test('a load of another URL reloads without force, the same URL is skipped', async () => {
  stub = stubFetch(async ({ path }) => json({ path }));
  const resource = createResource<{ path: string }, string>((id) => `/x/${id}`);
  await resource.load({ param: 'a' });
  await resource.load({ param: 'a' });
  assert.equal(stub.calls.length, 1);
  await resource.load({ param: 'b' });
  assert.equal(stub.calls.length, 2);
  assert.equal(resource.state.data?.path, '/x/b');
  await resource.load({ param: 'b' });
  assert.equal(stub.calls.length, 2);
});

test('a plain load joins the running request of the same URL', async () => {
  const offen = gate();
  stub = stubFetch(async () => {
    await offen.promise;
    return json({ n: 1 });
  });
  const resource = createResource<{ n: number }>('/x');
  const first = resource.load();
  const second = resource.load();
  assert.equal(first, second);
  offen.open();
  await first;
  assert.equal(stub.calls.length, 1);
});

test('a load of another URL does not join, aborts the older request and wins over its late answer', async () => {
  const alt = gate();
  stub = stubFetch(async ({ path }) => {
    if (path === '/x/a') await alt.promise;
    return json({ path });
  });
  const resource = createResource<{ path: string }, string>((id) => `/x/${id}`);
  const first = resource.load({ param: 'a' });
  const second = resource.load({ param: 'b' });
  assert.notEqual(first, second);
  assert.equal(stub.calls[0].signal?.aborted, true);
  assert.equal(stub.calls[1].signal?.aborted, false);
  await second;
  alt.open();
  await first;
  assert.equal(resource.state.data?.path, '/x/b');
  assert.equal(resource.state.loading, false);
});

test('force starts its own request instead of joining one that began earlier', async () => {
  const alt = gate();
  let calls = 0;
  stub = stubFetch(async () => {
    if (++calls === 1) {
      await alt.promise;
      return json({ v: 'alt' });
    }
    return json({ v: 'neu' });
  });
  const resource = createResource<{ v: string }>('/x');
  const first = resource.load();
  const second = resource.load({ force: true });
  assert.notEqual(first, second);
  await second;
  alt.open();
  await first;
  assert.equal(resource.state.data?.v, 'neu');
});

test('set after a write beats a load still in flight and settles it', async () => {
  const alt = gate();
  stub = stubFetch(async () => {
    await alt.promise;
    return json({ v: 'vor dem Schreiben' });
  });
  const resource = createResource<{ v: string }>('/x');
  const running = resource.load();
  resource.set({ v: 'nach dem Schreiben' });
  assert.equal(resource.state.loading, false);
  alt.open();
  await running;
  assert.equal(resource.state.data?.v, 'nach dem Schreiben');
  assert.equal(resource.state.loading, false);
  assert.equal(resource.state.error, null);
});

test('invalidate makes the next load ask again, and never joins a request from before it', async () => {
  const alt = gate();
  let calls = 0;
  stub = stubFetch(async () => {
    if (++calls === 2) {
      await alt.promise;
      return json({ v: 'alt' });
    }
    return json({ v: calls === 1 ? 'erst' : 'neu' });
  });
  const resource = createResource<{ v: string }>('/x');
  await resource.load();
  await resource.load();
  assert.equal(stub.calls.length, 1);
  resource.invalidate();
  const running = resource.load();
  assert.equal(resource.state.data?.v, 'erst');
  resource.invalidate();
  const next = resource.load();
  assert.notEqual(running, next);
  await next;
  alt.open();
  await running;
  assert.equal(resource.state.data?.v, 'neu');
});

test('maxAge 0 asks again unless a request is running', async () => {
  const offen = gate();
  let calls = 0;
  stub = stubFetch(async () => {
    if (++calls === 2) await offen.promise;
    return json({ n: calls });
  });
  const resource = createResource<{ n: number }>('/x');
  await resource.load({ maxAge: 0 });
  const second = resource.load({ maxAge: 0 });
  const third = resource.load({ maxAge: 0 });
  assert.equal(second, third);
  offen.open();
  await second;
  assert.equal(stub.calls.length, 2);
});

test('refresh asks the server to read again, never joins, and the plain load stays cached', async () => {
  const alt = gate();
  let calls = 0;
  stub = stubFetch(async ({ path }) => {
    if (++calls === 1) {
      await alt.promise;
      return json({ v: 'alt' });
    }
    return json({ v: path.includes('refresh=true') ? 'neu' : 'plain' });
  });
  const resource = createResource<{ v: string }, string>((id) => `/x/${id}?a=1`, {
    refreshable: true,
  });
  const first = resource.load({ param: 'k' });
  const refreshed = resource.refresh('k');
  assert.notEqual(first, refreshed);
  await refreshed;
  alt.open();
  await first;
  assert.equal(stub.calls[1].path, '/x/k?a=1&refresh=true');
  assert.equal(resource.state.data?.v, 'neu');
  await resource.load({ param: 'k' });
  assert.equal(stub.calls.length, 2);
  await resource.load({ param: 'other' });
  assert.equal(stub.calls.length, 3);
});

test('an error keeps the data, carries the code of the server and is cleared by the next load', async () => {
  let fail = false;
  stub = stubFetch(async () =>
    fail ? json({ code: 'NOPE', message: 'Geht nicht.' }, 404) : json({ v: 1 })
  );
  const resource = createResource<{ v: number }>('/x');
  await resource.load();
  fail = true;
  await resource.load({ force: true });
  assert.equal(resource.state.error, 'Geht nicht.');
  assert.equal(resource.state.errorCode, 'NOPE');
  assert.deepEqual(resource.state.data, { v: 1 });
  fail = false;
  await resource.load({ force: true });
  assert.equal(resource.state.error, null);
  assert.equal(resource.state.errorCode, null);
});

test('transform turns the answer into the shown data and isCurrent follows the loads', async () => {
  stub = stubFetch(async () => json([3, 1, 2]));
  const resource = createResource<number[], void, number[]>('/x', {
    transform: (answer) => [...answer].sort(),
  });
  assert.equal(resource.isCurrent(), false);
  await resource.load();
  assert.deepEqual(resource.state.data, [1, 2, 3]);
  assert.equal(resource.isCurrent(), true);
  assert.equal(resource.isCurrent(0), false);
  resource.invalidate();
  assert.equal(resource.isCurrent(), false);
});

test('a resource that starts idle is not loading before the first load', () => {
  assert.equal(createResource<number>('/x', { idle: true }).state.loading, false);
  assert.equal(createResource<number>('/x').state.loading, true);
});
