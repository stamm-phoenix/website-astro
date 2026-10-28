import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aktionTage,
  formatZeit,
  istNachUhrzeit,
  kurzbeschreibungPdfData,
  mitAktionTagen,
  nachUhrzeit,
  parseZeitzeilen,
  tagTitel,
  zeitplanTage,
} from '../src/lib/kurzbeschreibung';

test('the days of the Aktion prefill the Zeitplan until something was entered', () => {
  assert.deepEqual(aktionTage('2026-05-30', '2026-06-01'), [
    '2026-05-30',
    '2026-05-31',
    '2026-06-01',
  ]);
  // CampFlow sends points in time as well; 23:30 UTC is the next day in Berlin
  assert.deepEqual(aktionTage('2026-05-29T23:30:00Z', null), ['2026-05-30']);
  assert.deepEqual(aktionTage(null, null), []);
  assert.deepEqual(
    zeitplanTage({ einleitung: '', tage: [] }, '2026-05-30', '2026-05-31').map((t) => t.datum),
    ['2026-05-30', '2026-05-31']
  );
  const entered = [{ datum: '2026-06-02', bloecke: [] }];
  assert.equal(zeitplanTage({ einleitung: '', tage: entered }, '2026-05-30', null), entered);
  assert.equal(tagTitel('2026-05-25'), 'Montag, 25.05.2026');
});

test('pasted lines become blocks, with the usual ways to write times', () => {
  assert.deepEqual(
    parseZeitzeilen(
      [
        '8-14 Uhr Hike + Anreise',
        '8:15-9 Uhr Frühstück',
        '20.30 - … Versprechen',
        '22 Uhr Zahnputzparty',
        '10- 12,30 Capture the Flag',
        '08:00\t09:00\tMorgenrunde',
        '',
        'Ganztags Hike',
        '3 Teams spielen gegeneinander',
        '19.30-20 Uhr: Leitendenrunde',
      ].join('\n')
    ),
    [
      { von: '08:00', bis: '14:00', text: 'Hike + Anreise' },
      { von: '08:15', bis: '09:00', text: 'Frühstück' },
      { von: '20:30', bis: '', text: 'Versprechen' },
      { von: '22:00', bis: '', text: 'Zahnputzparty' },
      { von: '10:00', bis: '12:30', text: 'Capture the Flag' },
      { von: '08:00', bis: '09:00', text: 'Morgenrunde' },
      { von: '', bis: '', text: 'Ganztags Hike' },
      { von: '', bis: '', text: '3 Teams spielen gegeneinander' },
      { von: '19:30', bis: '20:00', text: 'Leitendenrunde' },
    ]
  );
});

test('times are shown short and blocks sort by their start', () => {
  assert.equal(formatZeit({ von: '08:00', bis: '09:30' }), '8:00–9:30');
  assert.equal(formatZeit({ von: '20:30', bis: '' }), '20:30');
  const bloecke = [
    { id: 'a', von: '18:00', bis: '', text: 'Abendessen' },
    { id: 'b', von: '', bis: '', text: 'Hike' },
    { id: 'c', von: '08:00', bis: '', text: 'Frühstück' },
    { id: 'd', von: '08:00', bis: '', text: 'Morgenrunde' },
  ];
  assert.equal(istNachUhrzeit(bloecke), false);
  const sorted = nachUhrzeit(bloecke);
  assert.deepEqual(
    sorted.map((b) => b.id),
    ['b', 'c', 'd', 'a']
  );
  assert.equal(istNachUhrzeit(sorted), true);
});

test('days read from a file keep the days of the Aktion', () => {
  const tage = mitAktionTagen(
    [
      { datum: '2026-05-31', bloecke: [{ von: '10:00', bis: '', text: 'Abbau' }] },
      { datum: '2026-05-29', bloecke: [{ von: '', bis: '', text: 'Packen' }] },
    ],
    '2026-05-30',
    '2026-05-31'
  );
  assert.deepEqual(
    tage.map((t) => [t.datum, t.bloecke.map((b) => b.text)]),
    [
      ['2026-05-29', ['Packen']],
      ['2026-05-30', []],
      ['2026-05-31', ['Abbau']],
    ]
  );
  assert.match(tage[0].bloecke[0].id, /^[A-Za-z0-9_-]{1,40}$/);
});

test('a block with only an end time keeps it in the PDF', () => {
  assert.equal(formatZeit({ von: '', bis: '10:00' }), 'bis 10:00');
  const data = kurzbeschreibungPdfData(
    'Lager',
    '01.08.2026',
    { einleitung: '', tage: [] },
    [
      {
        datum: '2026-08-01',
        bloecke: [
          { id: 'a', von: '', bis: '10:00', text: '' },
          { id: 'b', von: '', bis: '', text: '  ' },
        ],
      },
    ],
    []
  );
  assert.deepEqual(data.tage, [
    { titel: 'Samstag, 01.08.2026', bloecke: [{ zeit: 'bis 10:00', text: '' }] },
  ]);
});
