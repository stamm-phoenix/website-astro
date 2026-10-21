import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { restoreDispoDraft } from '../src/lib/nikolausDispoPlan';
import type {
  StaffNikolausBooking,
  StaffNikolausDispoData,
  StaffNikolausDispoRow,
} from '../src/lib/types';

const DATE = '2026-12-05';

function booking(id: string, time: string): StaffNikolausBooking {
  return {
    id,
    slotKey: `${DATE}T${time}`,
    childrenCount: 1,
    internalTags: [],
    familyName: id,
  } as unknown as StaffNikolausBooking;
}

function row(bookingId: string, order: number, extra: Partial<StaffNikolausDispoRow> = {}) {
  return {
    bookingId,
    team: 'A',
    order,
    slotKey: `${DATE}T17:00`,
    plannedArrival: '17:00',
    fixed: false,
    visited: false,
    visitedAt: '',
    ...extra,
  };
}

function data(
  rows: StaffNikolausDispoRow[],
  stops = [booking('1', '17:00'), booking('2', '17:00'), booking('3', '17:00')]
): StaffNikolausDispoData {
  return {
    date: DATE,
    teams: [{ name: 'A', color: '#000' }],
    minutesPerChild: 5,
    minVisitMinutes: 10,
    maxVisitMinutes: 45,
    stops,
    travel: [
      [0, 5, 5, 5],
      [5, 0, 5, 5],
      [5, 5, 0, 5],
      [5, 5, 5, 0],
    ],
    travelSource: 'route',
    rows,
    version: 'v',
    pendingCount: 0,
    members: {},
  };
}

describe('restoring a saved Dispo', () => {
  test('puts visits checked off out of order first and asks to save', () => {
    const restored = restoreDispoDraft(
      data([
        row('1', 1),
        row('2', 2),
        row('3', 3, {
          visited: true,
          visitedAt: '17:20',
          checkedOffAt: '2026-12-05T16:20:00.000Z',
        }),
      ])
    );
    assert.deepEqual(restored.assignment.A, ['3', '1', '2']);
    assert.equal(restored.changes.length, 1);
  });

  test('keeps a saved order that already starts with the checked-off visits', () => {
    const restored = restoreDispoDraft(
      data([
        row('1', 1, { visited: true, visitedAt: '17:10' }),
        row('2', 2, { plannedArrival: '17:15' }),
        row('3', 3, { plannedArrival: '17:30' }),
      ])
    );
    assert.deepEqual(restored.assignment.A, ['1', '2', '3']);
    assert.deepEqual(restored.changes, []);
  });

  test('asks to save times calculated anew from a late check-off', () => {
    const restored = restoreDispoDraft(
      data(
        [
          row('1', 1, { visited: true, visitedAt: '17:30' }),
          row('2', 2, { plannedArrival: '17:15' }),
        ],
        [booking('1', '17:00'), booking('2', '17:00')]
      )
    );
    assert.deepEqual(restored.assignment.A, ['1', '2']);
    assert.equal(restored.changes.length, 1);
  });
});
