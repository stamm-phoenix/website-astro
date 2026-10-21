import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  dispoMapTeam,
  legSummary,
  pathKm,
  splitRoutePath,
  teamKmLabel,
} from '../src/lib/nikolausDispoMap';
import type { LatLon } from '../src/lib/nikolausDispoMap';
import type { DispoRoute } from '../src/lib/nikolausDispo';
import type { StaffNikolausBooking } from '../src/lib/types';

const BASE = { name: 'Pfarrheim', lat: 48, lon: 11 };

function booking(id: string, location: LatLon | null): StaffNikolausBooking {
  return {
    id,
    familyName: id,
    street: 'Weg 1',
    postalCode: '80000',
    city: 'Ort',
    childrenCount: 2,
    slotKey: '2026-12-05T17:00',
    location: location ? { lat: location[0], lon: location[1] } : null,
  } as unknown as StaffNikolausBooking;
}

function planned(
  id: string,
  arrival: number,
  end: number,
  drive: number
): DispoRoute['stops'][number] {
  return { id, arrival, start: arrival, end, driveMinutes: drive, lateInSlot: 0, lateAfterSlot: 0 };
}

describe('Dispo map', () => {
  test('without a course the drives are straight lines between the places', () => {
    const points: LatLon[] = [
      [48, 11],
      [48.1, 11],
      [48, 11],
    ];
    assert.deepEqual(splitRoutePath(null, points), [
      [
        [48, 11],
        [48.1, 11],
      ],
      [
        [48.1, 11],
        [48, 11],
      ],
    ]);
  });

  test('the course is cut at the point nearest to each visit, in route order', () => {
    // Out and back on the same road: the visit at the far end must not be cut on the way out
    const path: LatLon[] = [
      [48, 11],
      [48.05, 11],
      [48.1, 11],
      [48.05, 11.0001],
      [48, 11],
    ];
    const pieces = splitRoutePath(path, [
      [48, 11],
      [48.1, 11],
      [48.05, 11],
      [48, 11],
    ]);
    assert.equal(pieces.length, 3);
    assert.deepEqual(pieces[0], path.slice(0, 3));
    assert.deepEqual(pieces[1], path.slice(2, 4));
    assert.deepEqual(pieces[2], path.slice(3));
  });

  test('an earlier visit is not cut on the way back when that point lies closer', () => {
    // Start → A → B → A → Start: the point on the way back lies right on A
    const path: LatLon[] = [
      [48, 11],
      [48.05, 11.001],
      [48.1, 11],
      [48.05, 11],
      [48, 11],
    ];
    const pieces = splitRoutePath(path, [
      [48, 11],
      [48.05, 11],
      [48.1, 11],
      [48, 11],
    ]);
    assert.deepEqual(pieces, [path.slice(0, 2), path.slice(1, 3), path.slice(2)]);
  });

  test('a team gets one drive per visit plus the way back, with its times', () => {
    const stopsById = new Map([
      ['a', booking('a', [48.1, 11])],
      ['b', booking('b', [48.2, 11])],
    ]);
    const route: DispoRoute = {
      team: 'A',
      stops: [
        planned('a', 17 * 60 + 10, 17 * 60 + 25, 10),
        planned('b', 17 * 60 + 33, 17 * 60 + 50, 8),
      ],
      departure: 17 * 60,
      returnTime: 18 * 60 + 5,
      driveMinutes: 33,
      cost: 0,
    };
    const team = dispoMapTeam({
      route,
      color: '#000',
      base: BASE,
      stopsById,
      travelIndex: new Map([
        ['a', 1],
        ['b', 2],
      ]),
      travel: [
        [0, 10, 15],
        [10, 0, 8],
        [15, 8, 0],
      ],
      path: null,
      fixed: { b: 'A' },
      visited: new Set(['a']),
    });
    assert.deepEqual(
      team.legs.map((leg) => [leg.from, leg.to, leg.fromId, leg.toId, legSummary(leg, false)]),
      [
        ['Pfarrheim', 'Familie a', null, 'a', '17:00 → 17:10 · 10 Min Fahrt · 11 km Luftlinie'],
        ['Familie a', 'Familie b', 'a', 'b', '17:25 → 17:33 · 8 Min Fahrt · 11 km Luftlinie'],
        ['Familie b', 'Pfarrheim', 'b', null, '17:50 → 18:05 · 15 Min Fahrt · 22 km Luftlinie'],
      ]
    );
    assert.equal(team.kmAlongRoads, false);
    assert.equal(teamKmLabel(team), 'mind. 44 km Luftlinie');
    assert.deepEqual(
      team.stops.map((stop) => [stop.number, stop.fixed, stop.visited]),
      [
        [1, false, true],
        [2, true, false],
      ]
    );
  });

  test('drives from or to a visit without a place are left out', () => {
    const stopsById = new Map([
      ['a', booking('a', null)],
      ['b', booking('b', [48.2, 11])],
    ]);
    const route: DispoRoute = {
      team: 'A',
      stops: [planned('a', 1030, 1045, 10), planned('b', 1053, 1070, 8)],
      departure: 1020,
      returnTime: 1085,
      driveMinutes: 33,
      cost: 0,
    };
    const team = dispoMapTeam({
      route,
      color: '#000',
      base: BASE,
      stopsById,
      travelIndex: new Map([
        ['a', 1],
        ['b', 2],
      ]),
      travel: [
        [0, 10, 15],
        [10, 0, 8],
        [15, 8, 0],
      ],
      path: [
        [48, 11],
        [48.2, 11],
      ],
      fixed: {},
      visited: new Set(),
    });
    assert.deepEqual(
      team.unlocated.map((b) => b.id),
      ['a']
    );
    assert.deepEqual(
      team.stops.map((stop) => stop.number),
      [2]
    );
    assert.deepEqual(
      team.legs.map((leg) => [leg.from, leg.to]),
      [['Familie b', 'Pfarrheim']]
    );
  });

  test('kilometres follow the course and read in German', () => {
    // 0.1° of latitude is about 11.1 km
    assert.ok(
      Math.abs(
        pathKm([
          [48, 11],
          [48.1, 11],
        ]) - 11.12
      ) < 0.05
    );
    assert.equal(teamKmLabel({ km: 4.26, kmAlongRoads: true }), 'ca. 4,3 km');
    assert.equal(teamKmLabel({ km: null, kmAlongRoads: true }), null);
  });
});
