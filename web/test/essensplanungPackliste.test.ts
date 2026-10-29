import assert from 'node:assert/strict';
import test from 'node:test';
import { aenderungText } from '../src/lib/essensplanung.ts';
import {
  entwurfNachSpeichern,
  entwurfOffen,
  entwuerfeOhneZeile,
  fuerText,
  gefiltert,
  packliste,
  packId,
  packlisteDruck,
  zustaendigWahl,
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

test('the member responsible stays a choice after losing access, also when the view lacks them', () => {
  const mitglieder = [
    { id: 1, name: 'Kim', entzogen: false },
    { id: 2, name: 'Ben', entzogen: true },
  ];
  assert.deepEqual(zustaendigWahl(mitglieder, { zustaendigId: null, zustaendig: '' }), [
    { id: 1, name: 'Kim' },
  ]);
  assert.deepEqual(zustaendigWahl(mitglieder, { zustaendigId: 2, zustaendig: 'Ben' }), [
    { id: 1, name: 'Kim' },
    { id: 2, name: 'Ben' },
  ]);
  // Those who do not manage the members get no removed ones in the view
  assert.deepEqual(zustaendigWahl([mitglieder[0]], { zustaendigId: 2, zustaendig: 'Ben' }), [
    { id: 1, name: 'Kim' },
    { id: 2, name: 'Ben' },
  ]);
});

test('a typed free name is unsaved until the row shows it', () => {
  const zeilen = packliste(
    ansicht([eintrag({ id: 7, werkzeug: 'kochlöffel', name: 'Kochlöffel', zustaendig: 'Rover' })])
  );
  assert.equal(entwurfOffen({}, zeilen), false);
  // Opened without typing, or typed as saved
  assert.equal(
    entwurfOffen({ 'w:kochlöffel': { text: ' Rover ' }, 'w:pürierstab': { text: '' } }, zeilen),
    false
  );
  assert.equal(entwurfOffen({ 'w:kochlöffel': { text: 'Rover und Wö' } }, zeilen), true);
  assert.equal(entwurfOffen({ 'w:pürierstab': { text: 'Kim' } }, zeilen), true);
});

test('a save that went through takes its draft only while it is still the text sent', () => {
  const entwurf = {
    text: ' Rover ',
    name: 'Kochlöffel',
    etag: '"1"',
    gesendet: 'Rover',
    konflikt: false,
  };
  assert.equal(entwurfNachSpeichern(entwurf, 'Rover', '"2"'), null);
  assert.equal(entwurfNachSpeichern(undefined, 'Rover', '"2"'), null);
  // Typed on while it was saved: the text stays, on the version now saved
  assert.deepEqual(entwurfNachSpeichern({ ...entwurf, text: 'Rover und Wö' }, 'Rover', '"2"'), {
    text: 'Rover und Wö',
    name: 'Kochlöffel',
    etag: '"2"',
    gesendet: null,
    konflikt: false,
  });
});

test('a draft whose row is gone stays unsaved and is named to copy', () => {
  const zeilen = packliste(ansicht());
  // The waffle iron is on no planned dish: its typed name is not saved anywhere
  assert.equal(entwurfOffen({ 'w:waffeleisen': { text: 'Tante Erna' } }, zeilen), true);
  assert.equal(entwurfOffen({ 'w:waffeleisen': { text: '  ' } }, zeilen), false);
  assert.deepEqual(
    entwuerfeOhneZeile(
      {
        'w:waffeleisen': { text: ' Tante  Erna ', name: 'Waffeleisen' },
        'e:99': { text: 'Ben', name: 'Küchenzelt' },
        'w:kochlöffel': { text: 'Rover', name: 'Kochlöffel' },
        'w:alt': { text: '', name: 'Alt' },
      },
      zeilen
    ),
    [
      {
        key: 'w:waffeleisen',
        meldung:
          'Zuständig für Waffeleisen: „Tante Erna“ – das Werkzeug wird nicht mehr gebraucht.',
      },
      { key: 'e:99', meldung: 'Zuständig für Küchenzelt: „Ben“ – der Eintrag wurde entfernt.' },
      { key: 'w:alt', meldung: null },
    ]
  );
});
