import assert from 'node:assert/strict';
import test from 'node:test';
import { getTravelMatrix, UNKNOWN_TRIP_MINUTES } from '../lib/travel-times';

test('preview estimates never contact Azure Maps even when it is configured', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected service request');
  });
  const result = await getTravelMatrix(
    [{ lat: 47.9, lon: 11.9 }, { lat: 47.91, lon: 11.91 }, null],
    { estimateOnly: true }
  );
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(result.source, 'estimate');
  assert.equal(result.minutes[0][0], 0);
  assert.ok(result.minutes[0][1] > 0);
  assert.equal(result.minutes[0][1], result.minutes[1][0]);
  assert.equal(result.minutes[0][2], UNKNOWN_TRIP_MINUTES);
});
