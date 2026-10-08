import { test, expect } from '@playwright/test';
import { KEINE_ANPASSUNGEN, planFahrt } from '../src/lib/fahrtenPlan';
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
