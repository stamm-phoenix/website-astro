import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  favoritesStore,
  restoreFavorite,
  toggleFavorite,
} from '../src/lib/staffFavoritesStore.svelte';
import { json, stubFetch } from './fixtures/fetch-stub';

/** Removing a favorite offers „Rückgängig“, which puts it back where it was. */

const A = '/leitendenbereich/aufgaben';
const B = '/leitendenbereich/belege';
const C = '/leitendenbereich/aktionen';

let stub: ReturnType<typeof stubFetch> | null = null;

beforeEach(() => {
  favoritesStore.modules = [A, B, C];
  favoritesStore.saved = [A, B, C];
  favoritesStore.loaded = true;
  favoritesStore.loading = false;
  favoritesStore.loadError = null;
  favoritesStore.notice = null;
  stub = stubFetch(async () => json({}));
});
afterEach(() => stub?.restore());

async function settled(): Promise<void> {
  // The save runs after the current microtasks
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

test('removing a favorite names it and offers to undo it with its place', async () => {
  toggleFavorite(B, 'Belege');
  assert.deepEqual(favoritesStore.modules, [A, C]);
  await settled();
  assert.equal(favoritesStore.notice?.text, '„Belege“ ist kein Favorit mehr.');
  assert.deepEqual(favoritesStore.notice?.undo, { path: B, title: 'Belege', index: 1 });
});

test('adding a favorite offers no undo', async () => {
  toggleFavorite('/leitendenbereich/mitglieder', 'Mitglieder');
  await settled();
  assert.equal(favoritesStore.notice?.text, '„Mitglieder“ ist jetzt ein Favorit.');
  assert.equal(favoritesStore.notice?.undo, undefined);
});

test('undo puts the favorite back at its place and saves it', async () => {
  toggleFavorite(B, 'Belege');
  await settled();
  const undo = favoritesStore.notice?.undo;
  assert.ok(undo);
  restoreFavorite(undo);
  assert.deepEqual(favoritesStore.modules, [A, B, C]);
  await settled();
  assert.equal(favoritesStore.notice?.text, '„Belege“ ist wieder ein Favorit.');
  assert.deepEqual(favoritesStore.saved, [A, B, C]);
});

test('undo does nothing twice and never while the favorites reload', async () => {
  toggleFavorite(A, 'Aufgaben');
  await settled();
  const undo = favoritesStore.notice?.undo;
  assert.ok(undo);
  favoritesStore.loading = true;
  restoreFavorite(undo);
  assert.deepEqual(favoritesStore.modules, [B, C]);
  favoritesStore.loading = false;
  restoreFavorite(undo);
  restoreFavorite(undo);
  assert.deepEqual(favoritesStore.modules, [A, B, C]);
});
