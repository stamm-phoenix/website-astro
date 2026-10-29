import assert from 'node:assert/strict';
import test from 'node:test';
import { aenderungText } from '../src/lib/essensplanung.ts';
import {
  fuerText,
  gefiltert,
  packliste,
  packlisteDruck,
} from '../src/lib/essensplanungPackliste.ts';
import type { Gericht, PacklisteEintrag, PlanungAnsicht } from '../src/lib/types.ts';

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

const eintrag = (felder: Partial<PacklisteEintrag> & Pick<PacklisteEintrag, 'id' | 'name'>) => ({
  etag: '"1"',
  werkzeug: null,
  gepackt: false,
  zustaendigId: null,
  zustaendig: '',
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
    zeilen.map((zeile) => [zeile.eintrag, zeile.gepackt, zeile.zustaendigId, zeile.zustaendig]),
    [
      [null, false, null, ''],
      [null, false, null, ''],
      [null, false, null, ''],
    ]
  );
});

test('stored states belong to their tool; entries of its own join by name', () => {
  const topf = eintrag({
    id: 7,
    werkzeug: 'großer topf',
    name: 'großer topf',
    gepackt: true,
    zustaendigId: 4,
    zustaendig: 'Kim',
  });
  // A tool no planned dish needs any more stays stored, but is not on the list
  const alt = eintrag({ id: 8, werkzeug: 'waffeleisen', name: 'Waffeleisen', gepackt: true });
  const zelt = eintrag({ id: 9, name: 'Küchenzelt', zustaendig: 'Rover' });
  const zeilen = packliste(ansicht([topf, alt, zelt]));
  assert.deepEqual(
    zeilen.map((zeile) => [zeile.key, zeile.name, zeile.gepackt, zeile.zustaendig]),
    [
      ['w:großer topf', 'Großer Topf', true, 'Kim'],
      ['w:kochlöffel', 'Kochlöffel', false, ''],
      ['e:9', 'Küchenzelt', false, 'Rover'],
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
  assert.deepEqual(
    gefiltert(zeilen, 'meine', 4).map((z) => z.name),
    ['Großer Topf']
  );
  assert.deepEqual(gefiltert(zeilen, 'meine', null), []);
  assert.equal(gefiltert(zeilen, 'alle', null).length, 4);

  assert.deepEqual(packlisteDruck(zeilen.slice(0, 3)), [
    {
      gepackt: true,
      name: 'Großer Topf',
      fuer: 'Chili (1_2_1, 2_2_1) · Suppe (1_2_2)',
      zustaendig: 'Kim',
    },
    { gepackt: false, name: 'Kochlöffel', fuer: 'Chili (1_2_1, 2_2_1)', zustaendig: '' },
    { gepackt: false, name: 'Küchenzelt', fuer: '', zustaendig: 'Rover' },
  ]);
});

test('changes of the packing list say what happened', () => {
  const text = (aktion: string, details: Record<string, unknown>) =>
    aenderungText({ seq: 1, at: '', wer: 'Kim', aktion, details });
  assert.equal(
    text('packliste-geaendert', { name: 'Gaskocher', gepackt: true }),
    'Kim hat eingepackt: Gaskocher'
  );
  assert.equal(
    text('packliste-geaendert', { name: 'Gaskocher', gepackt: false }),
    'Kim hat wieder ausgepackt: Gaskocher'
  );
  assert.equal(
    text('packliste-geaendert', { name: 'Gaskocher', zustaendig: 'Ben' }),
    'Kim hat Ben zuständig gemacht: Gaskocher'
  );
  assert.equal(
    text('packliste-geaendert', { name: 'Gaskocher', zustaendig: '' }),
    'Kim hat eine Zuständigkeit entfernt: Gaskocher'
  );
  assert.equal(
    text('packliste-neu', { name: 'Gaskocher' }),
    'Kim hat etwas auf die Packliste gesetzt: Gaskocher'
  );
});
