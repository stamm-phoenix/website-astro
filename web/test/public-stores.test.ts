import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { aktionenStore, fetchAktionen, sortAktionen } from '../src/lib/aktionenStore.svelte';
import { blogStore, fetchBlogPosts } from '../src/lib/blogStore.svelte';
import { sortDownloads } from '../src/lib/downloadsStore.svelte';
import { sortGruppenstunden } from '../src/lib/gruppenstundenStore.svelte';
import { fetchNikolausSlots, nikolausStore } from '../src/lib/nikolausStore.svelte';
import { fetchVorstand, vorstandStore } from '../src/lib/vorstandStore.svelte';
import { loadStateOf, withBaked } from '../src/lib/storeView';
import type { Aktion, DownloadFile, Gruppenstunde } from '../src/lib/types/oeffentlich';
import { gate, json, stubFetch } from './fixtures/fetch-stub';

/** The public stores keep their `{ data, loading, error }` shape on top of `createResource`. */

let stub: ReturnType<typeof stubFetch> | null = null;
afterEach(() => stub?.restore());

function aktion(start: string): Aktion {
  return { start } as unknown as Aktion;
}

test('the sort helpers of the baked content leave the array they are given alone', () => {
  const aktionen = [aktion('2026-03-01'), aktion('2026-01-01')];
  assert.deepEqual(
    sortAktionen(aktionen).map((a) => a.start),
    ['2026-01-01', '2026-03-01']
  );
  assert.deepEqual(
    aktionen.map((a) => a.start),
    ['2026-03-01', '2026-01-01']
  );

  const downloads = [
    { lastModifiedAt: '2026-01-01' },
    { lastModifiedAt: '2026-03-01' },
  ] as unknown as DownloadFile[];
  assert.equal(sortDownloads(downloads)[0].lastModifiedAt, '2026-03-01');
  assert.equal(downloads[0].lastModifiedAt, '2026-01-01');

  const stunden = [{ stufe: 'Rover' }, { stufe: 'Wölflinge' }] as unknown as Gruppenstunde[];
  assert.equal(sortGruppenstunden(stunden)[0].stufe, 'Wölflinge');
  assert.equal(stunden[0].stufe, 'Rover');
});

test('a store loads sorted, starts loading and joins calls that overlap', async () => {
  const offen = gate();
  stub = stubFetch(async () => {
    await offen.promise;
    return json([aktion('2026-03-01'), aktion('2026-01-01')]);
  });
  assert.equal(aktionenStore.loading, true);
  const first = fetchAktionen();
  const second = fetchAktionen();
  offen.open();
  await Promise.all([first, second]);
  assert.equal(stub.calls.length, 1);
  assert.equal(aktionenStore.loading, false);
  assert.equal(aktionenStore.error, false);
  assert.equal(aktionenStore.data?.[0].start, '2026-01-01');
});

test('a store that refreshes baked content asks again after a finished load and keeps its data on a failure', async () => {
  let fail = false;
  stub = stubFetch(async () =>
    fail ? json({ message: 'Kaputt' }, 500) : json([aktion('2026-05-01')])
  );
  await fetchAktionen();
  assert.equal(stub.calls.length, 1);
  assert.equal(aktionenStore.data?.[0].start, '2026-05-01');
  fail = true;
  await fetchAktionen();
  assert.equal(stub.calls.length, 2);
  assert.equal(aktionenStore.error, true);
  assert.equal(aktionenStore.data?.length, 1);
});

test('the Vorstand store reports a failed first load as error and not loading', async () => {
  stub = stubFetch(async () => json({ message: 'Kaputt' }, 500));
  await fetchVorstand();
  assert.equal(vorstandStore.data, null);
  assert.equal(vorstandStore.loading, false);
  assert.equal(vorstandStore.error, true);
});

test('the blog is loaded once', async () => {
  stub = stubFetch(async () => json([{ id: 'a' }]));
  await fetchBlogPosts();
  await fetchBlogPosts();
  assert.equal(stub.calls.length, 1);
  assert.deepEqual(blogStore.data, [{ id: 'a' }]);
});

test('the slots keep showing while they reload and when the reload fails', async () => {
  let fail = false;
  const offen = gate();
  stub = stubFetch(async () => {
    if (fail) return json({ message: 'Kaputt' }, 500);
    await offen.promise;
    return json([{ key: 'a', available: 1 }]);
  });
  const first = fetchNikolausSlots();
  assert.equal(nikolausStore.loading, true);
  offen.open();
  await first;
  assert.equal(nikolausStore.loading, false);
  await fetchNikolausSlots();
  assert.equal(stub.calls.length, 1);

  fail = true;
  const reload = fetchNikolausSlots(true);
  // A reload of slots that are shown neither spins nor complains
  assert.equal(nikolausStore.loading, false);
  await reload;
  assert.equal(stub.calls.length, 2);
  assert.equal(nikolausStore.error, false);
  assert.equal(nikolausStore.data?.length, 1);
});

test('withBaked shows the baked data while the store has none, and the store once it has', () => {
  const state = { data: null as string[] | null, loading: true, error: null as string | null };
  const store = loadStateOf(state);
  assert.deepEqual(withBaked(store, ['baked']), { data: ['baked'], loading: false, error: false });
  assert.equal(withBaked(store, null), store);
  state.data = ['live'];
  assert.equal(withBaked(store, ['baked']).data?.[0], 'live');
  state.error = 'x';
  assert.equal(store.error, true);
});
