import { test, expect } from '@playwright/test';
import {
  KEINE_ANPASSUNGEN,
  fahrtenRows,
  planFahrt,
  withDriver,
  withMove,
  withRemoved,
} from '../src/lib/fahrtenPlan';
import type { FahrtPerson } from '../src/lib/fahrtenPlan';

const LEITENDE = 'Leitende / Ehemalige / Externe';

function person(id: string, gruppe: string, plaetze = 0, nachname = id): FahrtPerson {
  return { id, name: id, nachname, gruppe, plaetze: { hin: plaetze, rueck: plaetze } };
}

/** Driver id of the car each passenger sits in. */
function seating(personen: FahrtPerson[]): Record<string, string> {
  const plan = planFahrt(personen, 'hin');
  return Object.fromEntries(
    plan.autos.flatMap((auto) => auto.mitfahrende.map((p) => [p.id, auto.fahrer.id]))
  );
}

test('Leitende ride with Leitende first, then with the oldest children', () => {
  const personen = [
    person('woe-fahrer', '🟠 Wölfling', 5),
    person('rover-fahrer', '🔴 Rover', 4),
    person('leitung-fahrer', LEITENDE, 3),
    person('leitung-1', LEITENDE),
    person('leitung-2', LEITENDE),
    person('leitung-3', LEITENDE),
    person('rover', '🔴 Rover'),
    person('woe-1', '🟠 Wölfling'),
    person('woe-2', '🟠 Wölfling'),
    person('woe-3', '🟠 Wölfling'),
  ];

  const seats = seating(personen);
  const leitende = ['leitung-1', 'leitung-2', 'leitung-3'].map((id) => seats[id]);
  // The Leitende car is full of Leitende; the one left over rides with the Rover, not the Wölflinge
  expect(leitende.filter((fahrer) => fahrer === 'leitung-fahrer')).toHaveLength(2);
  expect(leitende).toContain('rover-fahrer');
  expect(leitende).not.toContain('woe-fahrer');
});

test('without a Leitende car, Leitende ride with the oldest Stufe that has seats', () => {
  const personen = [
    person('woe-fahrer', '🟠 Wölfling', 6),
    person('pfadi-fahrer', '🟢 Pfadfinder*in', 3),
    person('leitung', LEITENDE),
    person('woe-1', '🟠 Wölfling'),
    person('woe-2', '🟠 Wölfling'),
    person('woe-3', '🟠 Wölfling'),
    person('woe-4', '🟠 Wölfling'),
  ];

  expect(seating(personen).leitung).toBe('pfadi-fahrer');
});

test('siblings from different Stufen share a car when there is room', () => {
  const personen = [
    person('woe-fahrer', '🟠 Wölfling', 3),
    person('rover-fahrer', '🔴 Rover', 2),
    person('huber-woe', '🟠 Wölfling', 0, 'Huber'),
    person('huber-rover', '🔴 Rover', 0, 'Huber'),
    person('maier-woe', '🟠 Wölfling', 0, 'Maier'),
  ];

  const seats = seating(personen);
  expect(seats['huber-woe']).toBeDefined();
  expect(seats['huber-rover']).toBe(seats['huber-woe']);
});

test('a child rides with the sibling whose family drives, even when another car is filled first', () => {
  const personen = [
    person('woe-fahrer', '🟠 Wölfling', 5),
    person('erik', '🔵 Jungpfadfinder*in', 4, 'Radisch'),
    person('leah', '🟠 Wölfling', 0, 'Radisch'),
    person('woe-1', '🟠 Wölfling'),
    person('woe-2', '🟠 Wölfling'),
    person('jupfi-1', '🔵 Jungpfadfinder*in'),
    person('jupfi-2', '🔵 Jungpfadfinder*in'),
    person('pfadi', '🟢 Pfadfinder*in'),
  ];

  expect(seating(personen).leah).toBe('erik');
});

test('a sibling who is the only passenger of the family car stays there', () => {
  const personen = [
    person('woe-fahrer', '🟠 Wölfling', 5),
    person('erik', '🔵 Jungpfadfinder*in', 3, 'Radisch'),
    person('leah', '🟠 Wölfling', 0, 'Radisch'),
    person('woe-1', '🟠 Wölfling'),
    person('woe-2', '🟠 Wölfling'),
    person('woe-3', '🟠 Wölfling'),
  ];

  expect(seating(personen).leah).toBe('erik');
});

test('someone moved to no seat by hand is not picked as driver later', () => {
  const personen = [
    person('gross', '🟠 Wölfling', 5),
    person('mittel', '🟠 Wölfling', 4),
    person('klein', '🟠 Wölfling', 3),
    person('kind-1', '🟠 Wölfling'),
    person('kind-2', '🟠 Wölfling'),
    person('kind-3', '🟠 Wölfling'),
  ];
  const anpassungen = {
    ...KEINE_ANPASSUNGEN,
    keinFahrer: ['gross'],
    verschoben: [['klein', null]] satisfies [string, string | null][],
  };

  const plan = planFahrt(personen, 'hin', anpassungen);
  expect(plan.autos.map((auto) => auto.fahrer.id)).not.toContain('klein');
  expect(plan.ohnePlatz.map((p) => p.id)).toContain('klein');
});

test('the CSV export lists everyone in the plan, including those taken out', () => {
  const personen = [
    person('fahrer', '🟠 Wölfling', 3),
    person('kind', '🟠 Wölfling'),
    person('daheim', '🟠 Wölfling'),
  ];
  const plan = planFahrt(personen, 'hin', { ...KEINE_ANPASSUNGEN, entfernt: ['daheim'] });

  const rows = fahrtenRows([plan]).slice(1);
  expect(rows.map((row) => row[2]).sort()).toEqual(['daheim', 'fahrer', 'kind']);
  expect(rows.find((row) => row[2] === 'daheim')?.[1]).toBe('Nicht eingeplant');
});

test('someone taken out and planned back in returns to the seat chosen by hand', () => {
  const personen = [
    person('gross', '🟠 Wölfling', 4),
    person('klein', '🟠 Wölfling', 3),
    person('kind-1', '🟠 Wölfling'),
    person('kind-2', '🟠 Wölfling'),
    person('kind-3', '🟠 Wölfling'),
  ];
  const moved = withMove(KEINE_ANPASSUNGEN, 'kind-1', null);
  const back = withRemoved(withRemoved(moved, 'kind-1', true), 'kind-1', false);

  expect(planFahrt(personen, 'hin', back).ohnePlatz.map((p) => p.id)).toEqual(['kind-1']);
});

test("a driver's sibling keeps the family seat even when a Leitende passenger wants it", () => {
  const personen = [
    person('leitung-fahrer', LEITENDE, 2, 'Huber'),
    person('woe-fahrer', '🟠 Wölfling', 4),
    person('leitung', LEITENDE),
    person('huber-kind', '🟠 Wölfling', 0, 'Huber'),
    person('kind', '🟠 Wölfling'),
  ];

  const seats = seating(personen);
  expect(seats['huber-kind']).toBe('leitung-fahrer');
  expect(seats.leitung).toBe('woe-fahrer');
});

test('a Leitende sibling also rides in the family car first', () => {
  const personen = [
    person('leitung-fahrer', LEITENDE, 4),
    person('huber-fahrer', '🟠 Wölfling', 2, 'Huber'),
    person('huber-leitung', LEITENDE, 0, 'Huber'),
    person('kind-1', '🟠 Wölfling'),
    person('kind-2', '🟠 Wölfling'),
  ];

  expect(seating(personen)['huber-leitung']).toBe('huber-fahrer');
});

test('every Leitende who offered seats drives, even with only their own seat', () => {
  const personen = [
    person('woe-fahrer', '🟠 Wölfling', 6),
    person('leitung-allein', LEITENDE, 1),
    person('leitung-mit-platz', LEITENDE, 3),
    person('kind-1', '🟠 Wölfling'),
    person('kind-2', '🟠 Wölfling'),
  ];

  const plan = planFahrt(personen, 'hin');
  expect(plan.autos.map((auto) => auto.fahrer.id).sort()).toEqual(
    ['leitung-allein', 'leitung-mit-platz', 'woe-fahrer'].sort()
  );
});

test('a Leitende set to "Fährt nicht" rides along instead', () => {
  const personen = [
    person('woe-fahrer', '🟠 Wölfling', 6),
    person('leitung-allein', LEITENDE, 1),
    person('kind-1', '🟠 Wölfling'),
  ];

  const plan = planFahrt(personen, 'hin', { ...KEINE_ANPASSUNGEN, keinFahrer: ['leitung-allein'] });
  expect(plan.autos.map((auto) => auto.fahrer.id)).toEqual(['woe-fahrer']);
});

test('a car someone was moved into by hand stays in the plan when another driver is added', () => {
  const personen = [
    person('gross', '🟠 Wölfling', 5),
    person('mittel', '🟠 Wölfling', 3),
    person('extra', '🟠 Wölfling', 3),
    person('kind-1', '🟠 Wölfling'),
    person('kind-2', '🟠 Wölfling'),
    person('kind-3', '🟠 Wölfling'),
    person('kind-4', '🟠 Wölfling'),
  ];
  const anpassungen = withDriver(withMove(KEINE_ANPASSUNGEN, 'kind-1', 'mittel'), 'extra', true);

  const plan = planFahrt(personen, 'hin', anpassungen);
  const mittel = plan.autos.find((auto) => auto.fahrer.id === 'mittel');
  expect(mittel?.mitfahrende.map((p) => p.id)).toContain('kind-1');
});

test('someone moved to no seat by hand needs no seat, so no extra car drives for them', () => {
  const personen = [
    person('fahrer-a', '🟠 Wölfling', 4),
    person('fahrer-b', '🟠 Wölfling', 4),
    person('kind-1', '🟠 Wölfling'),
    person('kind-2', '🟠 Wölfling'),
    person('kind-3', '🟠 Wölfling'),
  ];

  const plan = planFahrt(personen, 'hin', withMove(KEINE_ANPASSUNGEN, 'kind-1', null));
  expect(plan.autos).toHaveLength(1);
  expect(plan.ohnePlatz.map((p) => p.id)).toEqual(['kind-1']);
});
