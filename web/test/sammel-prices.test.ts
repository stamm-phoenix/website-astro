import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSammelPrices } from '../src/lib/sammelPrices.svelte';
import type { SammelProductInfo } from '../../api/lib/sammelbestellung-model';

const lieferbar = async (): Promise<SammelProductInfo> => ({
  name: 'Ersatzartikel',
  imageUrl: null,
  unitPriceCents: 123,
  sourceUrl: 'https://example.org/ersatz',
  availability: 'available',
});

test('a replacement article clears obsolete lookup warnings and re-added articles are queried again', async () => {
  const pool = createSammelPrices();
  await pool.load(['removed-article'], async () => {
    throw new Error('lookup failed');
  });
  assert.deepEqual(Object.keys(pool.state.errors), ['removed-article']);

  await pool.load(['replacement-article'], lieferbar);
  await pool.load(['replacement-article'], lieferbar);
  assert.deepEqual(Object.keys(pool.state.errors), []);

  let queried = false;
  await pool.load(
    ['removed-article'],
    async () => {
      queried = true;
      return null;
    },
    true
  );
  assert.equal(queried, true);
  assert.deepEqual(Object.keys(pool.state.errors), []);
});
