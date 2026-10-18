import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { isSlotPast, formatTimestamp } from '../src/lib/nikolausAdmin';
import { formatTime } from '../src/lib/nikolausFahrtView';
import { formatTimestamp as belegTimestamp } from '../src/lib/belegForm';
import { localDate } from '../src/lib/dateUtils';

const originalZone = process.env.TZ;
process.env.TZ = 'America/Los_Angeles';
after(() => {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

test('a Nikolaus slot starts at Berlin time even on a device abroad', () => {
  assert.equal(isSlotPast('2026-12-05T17:00', new Date('2026-12-05T15:59:59Z')), false);
  assert.equal(isSlotPast('2026-12-05T17:00', new Date('2026-12-05T16:00:00Z')), true);
});

test('Fahrt and receipt timestamps use Berlin time in winter and summer', () => {
  for (const [iso, clock] of [
    ['2026-12-05T16:05:00Z', '17:05'],
    ['2026-07-05T16:05:00Z', '18:05'],
  ]) {
    const instant = new Date(iso);
    assert.equal(formatTime(instant), clock);
    assert.equal(belegTimestamp(iso), formatTimestamp(iso));
  }
});

test('the shared calendar day follows Berlin across midnight and year boundaries', () => {
  assert.equal(localDate(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
  assert.equal(localDate(new Date('2026-07-01T22:30:00Z')), '2026-07-02');
});
