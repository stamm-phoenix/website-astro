import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gerichtNamens,
  kalenderZeilen,
  nachbarPlatz,
  passtZurSuche,
  zielPosition,
  zustaendigAus,
} from '../src/lib/essensplanungPlan.ts';
import {
  bedarf,
  ohneMenge,
  personenFehlen,
  zeilenMenge,
} from '../src/lib/essensplanungRechnung.ts';
import type { PlanungMahlzeit, PlanungTag } from '../src/lib/types.ts';

const mahlzeit = (id: number, name: string, einplanungen: number[] = []): PlanungMahlzeit => ({
  id,
  etag: '',
  position: 1,
  kennung: String(id),
  name,
  einplanungen: einplanungen.map((e, index) => ({
    id: e,
    etag: '',
    gerichtId: 1,
    position: index + 1,
    faktor: 1,
    zustaendigId: null,
    zustaendig: '',
    status: 'offen',
    verbrauch: [],
  })),
  ohneGruppen: [],
});

const tag = (id: number, mahlzeiten: PlanungMahlzeit[]): PlanungTag =>
  ({ id, etag: '', datum: '2027-08-01', nummer: id, mahlzeiten }) as PlanungTag;

/** Arrival without breakfast, a day with a packed lunch, a day with two snacks. */
const tage = [
  tag(1, [mahlzeit(11, 'Abendessen', [101])]),
  tag(2, [
    mahlzeit(21, 'Frühstück', [201]),
    mahlzeit(22, 'Mittagessen', [202, 203]),
    mahlzeit(23, 'Lunchpaket'),
    mahlzeit(24, 'abendessen'),
  ]),
  tag(3, [mahlzeit(31, 'Frühstück'), mahlzeit(32, 'Snack'), mahlzeit(33, 'Snack')]),
];

test('the rows of the calendar follow the names of the meals, in the order of the days', () => {
  const zeilen = kalenderZeilen(tage);
  assert.deepEqual(
    zeilen.map((z) => [z.name, [...z.mahlzeiten.values()].map((m) => m.id)]),
    [
      ['Frühstück', [21, 31]],
      ['Snack', [32]],
      ['Snack', [33]],
      ['Mittagessen', [22]],
      ['Lunchpaket', [23]],
      ['Abendessen', [11, 24]],
    ]
  );
});

test('Alt and an arrow key move a dish within its meal, to the next meal or the next day', () => {
  // Down within lunch, then to the packed lunch
  assert.deepEqual(pick(nachbarPlatz(tage, 22, 202, 'runter')), [22, 2]);
  assert.deepEqual(pick(nachbarPlatz(tage, 22, 203, 'runter')), [23, 1]);
  // Up from the first dish of lunch: to the end of breakfast
  assert.deepEqual(pick(nachbarPlatz(tage, 22, 202, 'hoch')), [21, 2]);
  assert.equal(nachbarPlatz(tage, 11, 101, 'hoch'), null);
  // Right: dinner of day 1 to dinner of day 2, ignoring case
  assert.deepEqual(pick(nachbarPlatz(tage, 11, 101, 'rechts')), [24, 1]);
  // Day 3 has no lunch: nothing to the right
  assert.equal(nachbarPlatz(tage, 22, 202, 'rechts'), null);
  // Day 1 has no breakfast
  assert.equal(nachbarPlatz(tage, 21, 201, 'links'), null);
});

function pick(platz: ReturnType<typeof nachbarPlatz>): [number, number] | null {
  return platz ? [platz.mahlzeit.id, platz.position] : null;
}

test('a dropped dish gets its position without counting its old place', () => {
  const liste = [{ id: 1 }, { id: 2 }, { id: 3 }];
  // Dropped before the third: after the move it is second
  assert.equal(zielPosition(liste, 2, 1), 2);
  assert.equal(zielPosition(liste, 0, 3), 1);
  assert.equal(zielPosition(liste, 3, null), 4);
});

test('a typed name finds a dish and who is responsible', () => {
  const gerichte = [{ id: 1, name: 'Chili sin Carne' }];
  assert.equal(gerichtNamens(gerichte, '  chili SIN carne ')?.id, 1);
  assert.equal(gerichtNamens(gerichte, 'Chili'), undefined);
  const mitglieder = [
    { id: 5, name: 'Kim Küche', entzogen: false },
    { id: 6, name: 'Ben', entzogen: true },
  ];
  assert.deepEqual(zustaendigAus(' kim  küche ', mitglieder), {
    zustaendigId: 5,
    zustaendigText: '',
  });
  // Without access a member is just a name
  assert.deepEqual(zustaendigAus('Ben', mitglieder), { zustaendigId: null, zustaendigText: 'Ben' });
  assert.deepEqual(zustaendigAus('', mitglieder), { zustaendigId: null, zustaendigText: '' });
  assert.equal(passtZurSuche('Chili sin Carne', 'carne chi'), true);
  assert.equal(passtZurSuche('Chili sin Carne', 'Nudeln'), false);
});

test('a dish without people counts only its fixed amounts', () => {
  const zeile = (id: number, menge: number | null, fest = false) => ({
    id,
    planungZutatId: id,
    menge,
    einheit: menge === null ? null : ('g' as const),
    fest,
    fuerAlles: true,
    fuerVegetarisch: true,
    fuerVegan: true,
    ohne: [],
    nur: [],
  });
  assert.equal(zeilenMenge(zeile(1, 400), null, 10, 1), null);
  assert.equal(zeilenMenge(zeile(1, 400, true), null, 10, 1), 400);
  assert.equal(zeilenMenge(zeile(1, 400), 4, 10, 1), 1000);
  const gericht = {
    id: 1,
    personen: null,
    zutaten: [zeile(1, 400), zeile(2, 50, true), zeile(3, null)],
  };
  assert.equal(personenFehlen(gericht), true);
  assert.equal(personenFehlen({ ...gericht, zutaten: [zeile(2, 50, true)] }), false);
  const stand = {
    tage: [
      {
        mahlzeiten: [
          { id: 1, ohneGruppen: [], einplanungen: [{ id: 9, gerichtId: 1, faktor: 1 }] },
        ],
      },
    ],
    gruppen: [{ id: 1, faktor: 1 }],
    teilnehmende: [
      {
        gruppeId: 1,
        ernaehrung: 'alles' as const,
        anzahl: 10,
        unvertraeglichkeiten: [],
        vonMahlzeitId: null,
        bisMahlzeitId: null,
      },
    ],
    gerichte: [gericht],
  };
  // Only the fixed amount is needed; the scaled line and the one without amount are bought without
  assert.deepEqual(
    bedarf(stand).map((b) => [b.planungZutatId, b.menge]),
    [[2, 50]]
  );
  assert.deepEqual([...ohneMenge(stand)].sort(), [1, 3]);
});
