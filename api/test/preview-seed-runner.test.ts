import assert from 'node:assert/strict';
import test from 'node:test';
import { runSeedTracks } from '../lib/preview-seed-runner';

test('seed dependencies remain ordered while independent tracks overlap', async () => {
  const events: string[] = [];
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await runSeedTracks([
    [
      {
        name: 'parent',
        run: async () => {
          events.push('parent');
          await wait;
        },
      },
      {
        name: 'child',
        run: async () => {
          events.push('child');
        },
      },
    ],
    [
      {
        name: 'independent',
        run: async () => {
          events.push('independent');
          release();
        },
      },
    ],
  ]);
  assert.deepEqual(events, ['parent', 'independent', 'child']);
});

test('failed seed waits for other tracks and does not run its dependent steps', async () => {
  const events: string[] = [];
  await assert.rejects(
    runSeedTracks([
      [
        {
          name: 'bad',
          run: async () => {
            throw new Error('seed failed');
          },
        },
        {
          name: 'dependent',
          run: async () => {
            events.push('dependent');
          },
        },
      ],
      [
        {
          name: 'other',
          run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            events.push('finished');
          },
        },
      ],
    ]),
    /seed failed/
  );
  assert.deepEqual(events, ['finished']);
});
