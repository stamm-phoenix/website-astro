import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  folderEntry,
  forgetFotoFolder,
  isFresh,
  loadFotoFolder,
} from '../src/lib/fotoOrdnerStore.svelte';
import { gate, json, stubFetch } from './fixtures/fetch-stub';

/** The folders of the photo library are cached per path and dropped after an upload. */

let stub: ReturnType<typeof stubFetch> | null = null;
afterEach(() => stub?.restore());

function folder(name: string): unknown {
  return { name, files: [] };
}

test('a folder is loaded once while it is fresh, and shows as loading before its first answer', async () => {
  stub = stubFetch(async ({ path }) => json(folder(path)));
  assert.equal(folderEntry('a').loading, true);
  assert.equal(isFresh('a'), false);
  await loadFotoFolder('a');
  await loadFotoFolder('a');
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].path, '/intern/fotos/ordner?pfad=a');
  assert.equal(isFresh('a'), true);
  assert.equal(folderEntry('a').loading, false);
  await loadFotoFolder('a', { force: true });
  assert.equal(stub.calls.length, 2);
});

test('a folder named like an object property is an entry of its own', async () => {
  stub = stubFetch(async () => json(folder('x')));
  await loadFotoFolder('constructor');
  await loadFotoFolder('__proto__');
  assert.equal(folderEntry('constructor').data !== null, true);
  assert.equal(folderEntry('__proto__').data !== null, true);
  assert.equal(folderEntry('toString').data, null);
});

test('forgetting a folder drops it and the folders above it, not its neighbours', async () => {
  stub = stubFetch(async () => json(folder('x')));
  for (const path of ['', 'Lager', 'Lager/Tag 1', 'Anderes']) await loadFotoFolder(path);
  forgetFotoFolder('Lager/Tag 1');
  assert.deepEqual(['', 'Lager', 'Lager/Tag 1', 'Anderes'].map(isFresh), [
    false,
    false,
    false,
    true,
  ]);
  await loadFotoFolder('Lager/Tag 1');
  assert.equal(isFresh('Lager/Tag 1'), true);
});

test('a folder that is loading while it is forgotten is asked again and shows the newer answer', async () => {
  const alt = gate();
  let calls = 0;
  stub = stubFetch(async () => {
    if (++calls === 1) {
      await alt.promise;
      return json(folder('vor dem Hochladen'));
    }
    return json(folder('nach dem Hochladen'));
  });
  const first = loadFotoFolder('Hoch');
  forgetFotoFolder('Hoch');
  // The request from before the upload is replaced at once, not only after its answer
  assert.equal(stub.calls.length, 2);
  assert.equal(stub.calls[0].signal?.aborted, true);
  alt.open();
  await first;
  await loadFotoFolder('Hoch');
  assert.equal(stub.calls.length, 2);
  assert.equal((folderEntry('Hoch').data as { name: string }).name, 'nach dem Hochladen');
});
