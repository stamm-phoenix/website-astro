import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { CHANGELOG } from '../src/lib/changelogEntries';
import {
  changelogStore,
  loadChangelogSeen,
  markChangelogSeen,
  unseenCount,
} from '../src/lib/staffChangelogStore.svelte';
import { gate, json, stubFetch } from './fixtures/fetch-stub';

/** The seen state of the changelog is saved on the server; an answer may arrive in any order. */

const NEWEST = CHANGELOG[0].id;
const TWO_UNSEEN = CHANGELOG[2].id;

let stub: ReturnType<typeof stubFetch> | null = null;

beforeEach(() => {
  changelogStore.loaded = false;
  changelogStore.lastSeenId = null;
  changelogStore.loadError = null;
  changelogStore.saveError = null;
});
afterEach(() => stub?.restore());

test('a load that overlaps the save cannot bring back the unread count', async () => {
  const saved = gate();
  const staleAnswer = gate();
  let putStarted = false;
  stub = stubFetch(async ({ method }) => {
    if (method === 'PUT') {
      putStarted = true;
      await saved.promise;
      return json({ lastSeenId: NEWEST });
    }
    // The server read the state before the save and answers after it
    if (putStarted) {
      await staleAnswer.promise;
      return json({ lastSeenId: TWO_UNSEEN });
    }
    return json({ lastSeenId: TWO_UNSEEN });
  });
  await loadChangelogSeen();
  assert.equal(unseenCount(), 2);
  const saving = markChangelogSeen();
  const overlapping = loadChangelogSeen();
  saved.open();
  assert.equal(await saving, true);
  staleAnswer.open();
  await overlapping;
  assert.equal(changelogStore.lastSeenId, NEWEST);
  assert.equal(unseenCount(), 0);
});

test('a load that started before a save and answers after it is dropped as well', async () => {
  const staleAnswer = gate();
  let reads = 0;
  stub = stubFetch(async ({ method }) => {
    if (method === 'PUT') return json({ lastSeenId: NEWEST });
    if (++reads === 2) {
      await staleAnswer.promise;
      return json({ lastSeenId: TWO_UNSEEN });
    }
    return json({ lastSeenId: TWO_UNSEEN });
  });
  await loadChangelogSeen();
  const late = loadChangelogSeen();
  await markChangelogSeen();
  staleAnswer.open();
  await late;
  assert.equal(changelogStore.lastSeenId, NEWEST);
});

test('reading on another device shows at the next load that asks again', async () => {
  stub = stubFetch(() => json({ lastSeenId: TWO_UNSEEN }));
  await loadChangelogSeen({ maxAge: 5 * 60_000 });
  assert.equal(unseenCount(), 2);
  stub.restore();
  stub = stubFetch(() => json({ lastSeenId: NEWEST }));
  // A state younger than `maxAge` is kept without a request
  await loadChangelogSeen({ maxAge: 5 * 60_000 });
  assert.equal(stub.calls.length, 0);
  assert.equal(unseenCount(), 2);
  // The page „Neuigkeiten“ always asks
  await loadChangelogSeen();
  assert.equal(stub.calls.length, 1);
  assert.equal(unseenCount(), 0);
});

test('the message about a failed save stays when a later load succeeds', async () => {
  stub = stubFetch(({ method }) =>
    method === 'PUT' ? json({ error: 'unavailable' }, 503) : json({ lastSeenId: TWO_UNSEEN })
  );
  await loadChangelogSeen();
  assert.equal(await markChangelogSeen(), false);
  assert.ok(changelogStore.saveError);
  // The menu asks for the read state again, which succeeds
  assert.equal(await loadChangelogSeen(), true);
  assert.ok(changelogStore.saveError);
  assert.equal(unseenCount(), 2);
});

test('a failed load marks nothing as new and shows no count', async () => {
  stub = stubFetch(() => json({ error: 'unavailable' }, 503));
  assert.equal(await loadChangelogSeen(), false);
  assert.ok(changelogStore.loadError);
  assert.equal(unseenCount(), 0);
  assert.equal(
    stub.calls.every(({ method }) => method === 'GET'),
    true
  );
});
