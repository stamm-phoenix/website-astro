import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fahrtPdfTeam } from '../src/lib/nikolausFahrtPdf';
import type { StaffNikolausFahrtData, StaffNikolausFahrtStop } from '../src/lib/types';

const DATE = '2026-12-05';

function stop(id: string, extra: Partial<StaffNikolausFahrtStop> = {}): StaffNikolausFahrtStop {
  return {
    visitVersion: 'v',
    bookingId: id,
    order: Number(id),
    plannedArrival: '17:05',
    slotKey: `${DATE}T17:00`,
    moved: false,
    visited: false,
    visitedAt: '',
    familyName: `Muster ${id}`,
    phone: '',
    street: 'Hauptstraße 1',
    postalCode: '86899',
    city: 'Landsberg',
    addressNotes: '',
    childrenCount: 2,
    withKrampus: false,
    hidingPlace: '',
    notes: '',
    location: { lat: 48, lon: 10.9, approximate: false },
    ...extra,
  } as StaffNikolausFahrtStop;
}

const stops = [
  stop('1', {
    visited: true,
    visitedAt: '17:20',
    phone: '0170 123',
    hidingPlace: 'Garage',
    addressNotes: 'Hinterhaus',
    notes: 'Hund bellt',
  }),
  stop('2', {
    plannedArrival: '17:40',
    slotKey: `${DATE}T17:30`,
    moved: true,
    childrenCount: 1,
    withKrampus: true,
    location: null,
  }),
];

const data: StaffNikolausFahrtData = {
  date: DATE,
  teams: [
    { name: 'A', color: '#6d28d9' },
    { name: 'B', color: '#0f766e' },
  ],
  base: { name: 'Pfarrheim', lat: 48, lon: 10.9 },
  dispoSaved: true,
  routes: { A: stops, B: [] },
  members: { A: [{ name: 'Eva', role: 'Nikolaus' }] },
  unplannedCount: 0,
  droppedCount: 0,
};

describe('fahrtPdfTeam', () => {
  test('describes the team with its visits, helpers and progress', () => {
    const team = fahrtPdfTeam(data, 'A', stops);
    assert.equal(team.name, 'A');
    assert.equal(team.color, '#6d28d9');
    assert.deepEqual(team.lines, ['2 Termine · 3 Kinder · 1 von 2 besucht', 'Nikolaus: Eva']);
  });

  test('lists each visit with the visited state first and the hints after', () => {
    const [first, second] = fahrtPdfTeam(data, 'A', stops).stops;
    assert.equal(first.number, 1);
    assert.equal(first.time, 'ca. 17:05');
    assert.equal(first.slot, '17:00–17:30');
    assert.equal(first.family, 'Familie Muster 1');
    assert.equal(first.address, 'Hauptstraße 1, 86899 Landsberg');
    assert.equal(first.phone, '0170 123');
    assert.equal(first.children, '2 Kinder');
    assert.equal(first.done, true);
    assert.deepEqual(first.notes, [
      'Besucht um 17:20 Uhr',
      'Versteck: Garage',
      'Zur Adresse: Hinterhaus',
      'Bemerkungen: Hund bellt',
    ]);

    assert.equal(second.children, '1 Kind · mit Krampus');
    assert.equal(second.done, false);
    assert.deepEqual(second.notes, [
      'Seit der Dispo auf 17:30 Uhr verlegt',
      'Adresse nicht auf der Karte gefunden – bitte genau prüfen',
    ]);
  });

  test('says when the Dispo is no longer up to date and handles a team without visits', () => {
    const team = fahrtPdfTeam({ ...data, droppedCount: 1 }, 'B', []);
    assert.equal(team.color, '#0f766e');
    assert.deepEqual(team.lines, [
      '0 Termine · 0 Kinder',
      'Die Dispo ist nicht mehr ganz aktuell. Bitte gebt der Dispo Bescheid.',
    ]);
    assert.deepEqual(team.stops, []);
  });
});
