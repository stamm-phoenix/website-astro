import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObjectUrlCache } from '../src/lib/objectUrlCache';
import { settle } from './fixtures/fake-clock';

/** The previews of receipts: loaded once per version, older versions and old items freed. */

function cache(limit?: number): {
  urls: ObjectUrlCache;
  revoked: string[];
  loads: string[];
  load: (name: string) => () => Promise<Blob>;
} {
  const revoked: string[] = [];
  const loads: string[] = [];
  let created = 0;
  const urls = new ObjectUrlCache({
    limit,
    create: () => `blob:${++created}`,
    revoke: (url) => revoked.push(url),
  });
  const load = (name: string) => (): Promise<Blob> => {
    loads.push(name);
    return Promise.resolve(new Blob([name]));
  };
  return { urls, revoked, loads, load };
}

test('the same version is loaded once', async () => {
  const { urls, loads, load } = cache();
  const first = await urls.get('1', 'a', load('1a'));
  const again = await urls.get('1', 'a', load('1a'));
  assert.equal(again, first);
  assert.deepEqual(loads, ['1a']);
});

test('a new version replaces the older one and frees its URL once it has loaded', async () => {
  const { urls, revoked, load } = cache();
  const older = await urls.get('1', 'a', load('1a'));
  const newer = await urls.get('1', 'b', load('1b'));
  await settle();
  assert.notEqual(newer, older);
  assert.deepEqual(revoked, [older]);
  assert.equal(urls.size, 1);
});

test('a failed load is tried again and frees nothing', async () => {
  const { urls, revoked, loads } = cache();
  let fails = true;
  const load = (): Promise<Blob> => {
    loads.push('1a');
    return fails ? Promise.reject(new Error('offline')) : Promise.resolve(new Blob(['x']));
  };
  await assert.rejects(urls.get('1', 'a', load));
  await settle();
  assert.equal(urls.size, 0);
  fails = false;
  await urls.get('1', 'a', load);
  assert.deepEqual(loads, ['1a', '1a']);
  assert.deepEqual(revoked, []);
});

test('beyond the limit the item used longest ago goes', async () => {
  const { urls, revoked, load } = cache(2);
  const one = await urls.get('1', 'a', load('1'));
  await urls.get('2', 'a', load('2'));
  // Used again, so it stays
  await urls.get('1', 'a', load('1'));
  const three = urls.get('3', 'a', load('3'));
  await three;
  await settle();
  assert.equal(urls.size, 2);
  assert.deepEqual(revoked, ['blob:2']);
  assert.equal(await urls.get('1', 'a', load('1')), one);
});
