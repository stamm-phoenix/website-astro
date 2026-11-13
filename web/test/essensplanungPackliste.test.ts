import assert from 'node:assert/strict';
import test from 'node:test';
import { packlisteSchluessel } from '../../api/lib/essen-packliste-model.ts';
import {
  fuerText,
  gefiltert,
  packliste,
  packId,
  packlisteDruck,
  personenText,
} from '../src/lib/essensplanungPackliste.ts';
import type { Gericht } from '../../api/lib/essen-gerichte-model.ts';
import type { PackZuteilung, PacklisteEintrag } from '../../api/lib/essen-packliste-model.ts';
import type { PlanungAnsicht } from '../../api/lib/essen-planung-model.ts';

const gericht = (id: number, name: string, werkzeuge: string[]): Gericht => ({
  id,
  etag: '',
  name,
  personen: 10,
  anleitung: '',
  notiz: '',
  links: [],
  werkzeuge,
  zutaten: [],
});

const einplanung = (id: number, gerichtId: number) => ({
  id,
  etag: '',
  gerichtId,
  position: 1,
  faktor: 1,
  zustaendigId: null,
  zustaendig: '',
  status: 'offen' as const,
  verbrauch: [],
});

const mahlzeit = (id: number, kennung: string, einplanungen: ReturnType<typeof einplanung>[]) => ({
  id,
  etag: '',
  position: 1,
  kennung,
  name: 'Mittagessen',
  uhrzeit: null,
  einplanungen,
  ohneGruppen: [],
});

const eintrag = (
  felder: Partial<PacklisteEintrag> & Pick<PacklisteEintrag, 'id' | 'name'>
): PacklisteEintrag => ({
  etag: '"1"',
  werkzeug: null,
  gepackt: false,
  zuteilungen: [],
  ...felder,
});

function ansicht(
  packlisteEintraege: PacklisteEintrag[] = []
): Pick<PlanungAnsicht, 'tage' | 'gerichte' | 'packliste'> {
  return {
    gerichte: [
      gericht(1, 'Chili', ['Großer Topf', 'Kochlöffel']),
      gericht(2, 'Suppe', [' großer  TOPF ', 'Pürierstab', 'Großer Topf']),
      // Not planned: its tool is not packed
      gericht(3, 'Waffeln', ['Waffeleisen']),
    ],
    tage: [
      {
        id: 1,
        etag: '',
        datum: '2027-08-01',
        nummer: 1,
        mahlzeiten: [mahlzeit(10, '1_2', [einplanung(100, 1), einplanung(101, 2)])],
      },
      {
        id: 2,
        etag: '',
        datum: '2027-08-02',
        nummer: 2,
        mahlzeiten: [mahlzeit(20, '2_1', []), mahlzeit(21, '2_2', [einplanung(102, 1)])],
      },
    ],
    packliste: packlisteEintraege,
  };
}

const person = (
  id: number,
  mitgliedId: number | null,
  name: string,
  gepackt = false
): PackZuteilung => ({ id, etag: '"1"', mitgliedId, name, gepackt });

test('the tools of all planned dishes are merged by name, with their dishes and meals', () => {
  const zeilen = packliste(ansicht());
  assert.deepEqual(
    zeilen.map((zeile) => [zeile.key, zeile.name, fuerText(zeile)]),
    [
      ['w:großer topf', 'Großer Topf', 'Chili (1_2_1, 2_2_1) · Suppe (1_2_2)'],
      ['w:kochlöffel', 'Kochlöffel', 'Chili (1_2_1, 2_2_1)'],
      ['w:pürierstab', 'Pürierstab', 'Suppe (1_2_2)'],
    ]
  );
  // Nobody set anything yet
  assert.deepEqual(
    zeilen.map((zeile) => [zeile.eintrag, zeile.gepackt, zeile.personen]),
    [
      [null, false, []],
      [null, false, []],
      [null, false, []],
    ]
  );
});

test('stored states belong to their tool; entries of its own join by name', () => {
  const topf = eintrag({
    id: 7,
    werkzeug: 'großer topf',
    name: 'großer topf',
    gepackt: true,
    zuteilungen: [person(1, 4, 'Kim', true)],
  });
  // A tool no planned dish needs any more stays stored, but is not on the list
  const alt = eintrag({ id: 8, werkzeug: 'waffeleisen', name: 'Waffeleisen', gepackt: true });
  const zelt = eintrag({
    id: 9,
    name: 'Küchenzelt',
    zuteilungen: [person(2, null, 'Rover', true), person(3, 4, 'Kim')],
  });
  const zeilen = packliste(ansicht([topf, alt, zelt]));
  assert.deepEqual(
    zeilen.map((zeile) => [zeile.key, zeile.name, zeile.gepackt, personenText(zeile)]),
    [
      ['w:großer topf', 'Großer Topf', true, 'Kim'],
      ['w:kochlöffel', 'Kochlöffel', false, ''],
      ['e:9', 'Küchenzelt', false, 'Rover, Kim'],
      ['w:pürierstab', 'Pürierstab', false, ''],
    ]
  );
  assert.equal(zeilen[0].eintrag, topf);
  assert.equal(zeilen[2].werkzeug, null);

  assert.deepEqual(
    gefiltert(zeilen, 'offen', 4).map((z) => z.name),
    ['Kochlöffel', 'Küchenzelt', 'Pürierstab']
  );
  assert.deepEqual(
    gefiltert(zeilen, 'gepackt', 4).map((z) => z.name),
    ['Großer Topf']
  );
  // Mine: also a thing I pack with others
  assert.deepEqual(
    gefiltert(zeilen, 'meine', 4).map((z) => z.name),
    ['Großer Topf', 'Küchenzelt']
  );
  assert.deepEqual(gefiltert(zeilen, 'meine', null), []);
  assert.equal(gefiltert(zeilen, 'alle', null).length, 4);

  // On paper, with several persons who packed is named
  assert.deepEqual(packlisteDruck(zeilen.slice(0, 3)), [
    {
      gepackt: true,
      name: 'Großer Topf',
      fuer: 'Chili (1_2_1, 2_2_1) · Suppe (1_2_2)',
      zustaendig: 'Kim',
    },
    { gepackt: false, name: 'Kochlöffel', fuer: 'Chili (1_2_1, 2_2_1)', zustaendig: '' },
    { gepackt: false, name: 'Küchenzelt', fuer: '', zustaendig: 'Rover (gepackt), Kim' },
  ]);
});

test('rows whose names differ only in signs get their own ids', () => {
  const zeilen = packliste({
    ...ansicht(),
    gerichte: [gericht(1, 'Chili', ['Grill-Zange']), gericht(2, 'Suppe', ['Grill Zange'])],
  });
  assert.deepEqual(
    zeilen.map((zeile) => zeile.key),
    ['w:grill zange', 'w:grill-zange']
  );
  const ids = zeilen.map((zeile) => packId(zeile.key));
  assert.notEqual(ids[0], ids[1]);
  // Usable as one token of aria-describedby
  for (const id of ids) assert.doesNotMatch(id, /\s/);
});

test('a name with a lone surrogate gets an id too, distinct from its neighbours', () => {
  assert.equal(packId('w:a\ud800'), 'pack-0077003a0061d800');
  assert.notEqual(packId('w:\ud800'), packId('w:\ud801'));
  assert.notEqual(packId('w:\ud83d\ude00'), packId('w:\ud83d'));
  assert.match(packId('e:12'), /^pack-[0-9a-f]+$/);
});

test('an entry of its own named like a planned tool is one row, in either order', () => {
  const eigen = eintrag({
    id: 9,
    name: 'kochlöffel ',
    gepackt: true,
    zuteilungen: [person(1, null, 'Rover', true)],
  });
  // Added first, then a dish with the tool was planned
  const zeilen = packliste(ansicht([eigen]));
  const loeffel = zeilen.filter((zeile) => packlisteSchluessel(zeile.name) === 'kochlöffel');
  assert.deepEqual(
    loeffel.map((zeile) => [
      zeile.key,
      zeile.werkzeug,
      zeile.gepackt,
      personenText(zeile),
      fuerText(zeile),
    ]),
    [['e:9', null, true, 'Rover', 'Chili (1_2_1, 2_2_1)']]
  );
  assert.equal(loeffel[0].eintrag, eigen);
  // The tool was set first (its dish then left the plan), the entry came later: the entry wins
  const werkzeug = eintrag({
    id: 7,
    werkzeug: 'kochlöffel',
    name: 'Kochlöffel',
    zuteilungen: [person(2, null, 'Kim')],
  });
  const beide = packliste(ansicht([werkzeug, eigen]));
  assert.deepEqual(
    beide
      .filter((zeile) => packlisteSchluessel(zeile.name) === 'kochlöffel')
      .map((zeile) => [zeile.key, zeile.gepackt, personenText(zeile)]),
    [['e:9', true, 'Rover']]
  );
  assert.equal(beide.length, 3);
  assert.equal(packlisteDruck(beide).filter((z) => /kochlöffel/i.test(z.name)).length, 1);
});
