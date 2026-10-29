import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dispoPdfTeams } from '../src/lib/nikolausDispoPdf';
import type { DispoPlan } from '../src/lib/nikolausDispo';
import type { StaffNikolausBooking, StaffNikolausDispoData } from '../src/lib/types';

const DATE = '2026-12-05';

function booking(id: string, extra: Partial<StaffNikolausBooking> = {}): StaffNikolausBooking {
  return {
    id,
    slotKey: `${DATE}T17:00`,
    familyName: `Muster ${id}`,
    street: 'Hauptstraße 1',
    postalCode: '86899',
    city: 'Landsberg',
    phone: '',
    childrenCount: 2,
    withKrampus: false,
    hidingPlace: '',
    addressNotes: '',
    notes: '',
    internalTags: [],
    ...extra,
  } as unknown as StaffNikolausBooking;
}

const data: StaffNikolausDispoData = {
  date: DATE,
  teams: [
    { name: 'A', color: '#6d28d9' },
    { name: 'B', color: '#0f766e' },
  ],
  minutesPerChild: 5,
  minVisitMinutes: 10,
  maxVisitMinutes: 45,
  stops: [
    booking('1', { phone: '0170 123', hidingPlace: 'Garage', internalTags: ['Hund'] }),
    booking('2', { childrenCount: 1, withKrampus: true }),
  ],
  travel: [],
  travelSource: 'route',
  rows: [
    {
      bookingId: '1',
      team: 'A',
      order: 1,
      slotKey: `${DATE}T17:00`,
      plannedArrival: '17:05',
      fixed: false,
      visited: true,
      visitedAt: '17:20',
    },
  ],
  version: 'v',
  pendingCount: 0,
  members: {
    A: [{ personId: 'p', name: 'Eva', role: 'Nikolaus', negativeTags: ['Hund'], positiveTags: [] }],
  },
};

const plan: DispoPlan = {
  cost: 0,
  routes: [
    {
      team: 'A',
      departure: 16 * 60 + 50,
      returnTime: 18 * 60 + 10,
      driveMinutes: 24.4,
      cost: 0,
      stops: [
        {
          id: '1',
          arrival: 17 * 60 + 5,
          start: 17 * 60 + 5,
          end: 17 * 60 + 15,
          driveMinutes: 15,
          lateInSlot: 5,
          lateAfterSlot: 0,
        },
        {
          id: '2',
          arrival: 18 * 60 + 5,
          start: 18 * 60 + 5,
          end: 18 * 60 + 15,
          driveMinutes: 9.6,
          lateInSlot: 65,
          lateAfterSlot: 5,
        },
      ],
    },
    { team: 'B', departure: null, returnTime: null, driveMinutes: 0, cost: 0, stops: [] },
  ],
};

describe('dispoPdfTeams', () => {
  const teams = dispoPdfTeams({ data, plan, baseName: 'Pfarrheim', km: () => 'ca. 12 km' });

  test('describes each team with its times and helpers', () => {
    assert.equal(teams.length, 2);
    assert.equal(teams[0].color, '#6d28d9');
    assert.deepEqual(teams[0].lines, [
      '2 Termine · 3 Kinder',
      'Abfahrt Pfarrheim 16:50 · zurück ca. 18:10 · Fahrzeit 24 Min · Strecke ca. 12 km',
      'Nikolaus: Eva',
    ]);
    assert.deepEqual(teams[1].lines, ['0 Termine · 0 Kinder']);
    assert.deepEqual(teams[1].stops, []);
  });

  test('lists the visits with warnings before the hints', () => {
    const [first, second] = teams[0].stops;
    assert.equal(first.time, '17:05');
    assert.equal(first.slot, '17:00–17:30');
    assert.equal(first.family, 'Familie Muster 1');
    assert.equal(first.address, 'Hauptstraße 1, 86899 Landsberg');
    assert.equal(first.phone, '0170 123');
    assert.equal(first.children, '2 Kinder · ca. 10 Min · Anfahrt 15 Min');
    assert.deepEqual(first.notes, [
      'Achtung: Eva – nicht zu Familien mit „Hund“',
      'Versteck: Garage',
      'Merkmale: Hund',
      'Besucht um 17:20 Uhr',
    ]);
    assert.equal(first.late, false);

    assert.equal(second.number, 2);
    assert.equal(second.children, '1 Kind · ca. 10 Min · mit Krampus · Anfahrt 10 Min');
    assert.deepEqual(second.notes, ['5 Min nach Ende des gebuchten Termins']);
    assert.equal(second.late, true);
  });
});
