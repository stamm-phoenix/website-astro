import assert from 'node:assert/strict';
import test from 'node:test';
import { collectGraphCollectionPages } from '../lib/sharepoint-data-access';

test('collectGraphCollectionPages combines every Graph result page', async () => {
  const requestedLinks: string[] = [];
  const items = await collectGraphCollectionPages(
    {
      value: [{ id: 'first' }],
      '@odata.nextLink': 'https://graph.microsoft.com/next-page',
    },
    async (nextLink) => {
      requestedLinks.push(nextLink);
      return { value: [{ id: 'second' }] };
    }
  );

  assert.deepEqual(items, [{ id: 'first' }, { id: 'second' }]);
  assert.deepEqual(requestedLinks, ['https://graph.microsoft.com/next-page']);
});

test('collectGraphCollectionPages preserves a single page response', async () => {
  const items = await collectGraphCollectionPages({ value: [{ id: 'only' }] }, async () => {
    throw new Error('A continuation page should not be requested');
  });

  assert.deepEqual(items, [{ id: 'only' }]);
});
