import assert from 'node:assert/strict';
import test from 'node:test';
import { averageMembers, monthlyStats } from '../src/lib/anwesenheit.ts';
import type { AnwesenheitMeeting } from '../src/lib/types.ts';

function meeting(date: string, members: number, cancelled = false): AnwesenheitMeeting {
  return { stufe: 'Wölflinge', date, members, excused: 1, guests: 0, notes: '', cancelled };
}

test('a cancelled Gruppenstunde does not lower the average of its month', () => {
  const [october] = monthlyStats(
    [
      meeting('2026-10-02', 6),
      meeting('2026-10-09', 0, true),
      meeting('2026-10-16', 8),
      { ...meeting('2026-10-16', 3), stufe: 'Rover' },
    ],
    'Wölflinge'
  );

  assert.deepEqual(october, {
    month: '2026-10',
    termine: 2,
    cancelled: 1,
    members: 14,
    excused: 2,
    guests: 0,
  });
  assert.equal(averageMembers(october), 7);
});

test('a month with only cancelled Gruppenstunden has an average of 0', () => {
  const [month] = monthlyStats([meeting('2026-08-07', 0, true)], 'Wölflinge');

  assert.equal(month.termine, 0);
  assert.equal(averageMembers(month), 0);
});
