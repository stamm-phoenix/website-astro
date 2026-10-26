import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  kategorieSchreibweise,
  kategorieVorschlaege,
  zuordnungTreffer,
  zuordnungStand,
  zuordnungVorschlaege,
} from '../src/lib/belegZuordnung';
import { filterVorschlaege } from '../src/lib/vorschlaege';

const UNITS = [
  {
    id: 'cun_allg',
    name: 'Allgemein',
    archived: false,
    categories: [
      { id: 'cat_runde', name: 'Leitendenrunde' },
      { id: 'cat_mat', name: 'Material' },
    ],
  },
  {
    id: 'cun_lela',
    name: 'Leitendenlager 2026',
    archived: false,
    categories: [
      { id: 'cat_tn', name: 'Teilnahmebeiträge' },
      { id: 'cat_fahrt', name: 'Fahrtkosten' },
    ],
  },
  { id: 'cun_alt', name: 'Leitendenlager 2019', archived: true, categories: [] },
];

test('the search finds Kostenstellen and Kategorien by their own names', () => {
  const { matches } = filterVorschlaege(zuordnungVorschlaege(UNITS, 'leite'), 'leite', 20);
  assert.deepEqual(
    matches.map((m) => [m.gruppe, zuordnungTreffer(UNITS, m)]),
    [
      ['Kostenstellen', { kostenstelle: 'Leitendenlager 2026', kategorie: null }],
      ['Kategorie in Allgemein', { kostenstelle: 'Allgemein', kategorie: 'Leitendenrunde' }],
    ]
  );
});

test('the standard Kategorien come first, a Kostenstelle adds only its others', () => {
  assert.deepEqual(
    kategorieVorschlaege(UNITS, 'leitendenlager 2026').map((v) => [v.gruppe, v.value]),
    [
      ['Standard', 'Fahrtkosten'],
      ['Standard', 'Verpflegungskosten'],
      ['Standard', 'Miet- und Übernachtungskosten'],
      ['Standard', 'Honorare'],
      ['Standard', 'Arbeits- und Hilfsmittel'],
      ['Weitere in dieser Kostenstelle', 'Teilnahmebeiträge'],
    ]
  );
});

test('new names are told apart from existing and standard ones', () => {
  const stand = (kostenstelle: string, kategorie: string) =>
    zuordnungStand(UNITS, kostenstelle, kategorie);
  assert.equal(zuordnungStand(null, 'Allgemein', 'Material'), null);
  assert.deepEqual(stand(' allgemein ', 'MATERIAL'), {
    neueKostenstelle: false,
    archiviert: false,
    neueKategorie: false,
    neueStandardKategorie: false,
  });
  assert.equal(stand('Allgemein', 'Honorare')?.neueKategorie, false);
  assert.equal(stand('Allgemein', 'Honorare')?.neueStandardKategorie, true);
  assert.equal(stand('Allgemein', 'Getränke')?.neueKategorie, true);
  assert.equal(stand('Herbstfahrt', 'Honorare')?.neueKostenstelle, true);
  assert.equal(stand('Leitendenlager 2019', 'Honorare')?.archiviert, true);
});

test('a standard Kategorie takes its own spelling, others stay as typed', () => {
  assert.equal(kategorieSchreibweise(' honorare '), 'Honorare');
  assert.equal(kategorieSchreibweise('arbeits-  und hilfsmittel'), 'Arbeits- und Hilfsmittel');
  assert.equal(kategorieSchreibweise('getränke'), 'getränke');
});

test('more words narrow the many Kategorien of the same name down to their Kostenstelle', () => {
  const units = Array.from({ length: 15 }, (_, n) => ({
    id: `cun_${n}`,
    name: n === 14 ? 'Stammeslager 2026' : `Lager ${n}`,
    archived: false,
    categories: [{ id: `cat_${n}`, name: 'Verpflegung' }],
  }));
  const search = (query: string) =>
    filterVorschlaege(zuordnungVorschlaege(units, query), query, 12);
  assert.equal(search('verpflegung').total, 15);
  const narrowed = search('Verpflegung  stammes');
  assert.deepEqual(
    narrowed.matches.map((m) => zuordnungTreffer(units, m)),
    [{ kostenstelle: 'Stammeslager 2026', kategorie: 'Verpflegung' }]
  );
  // Words only in the Kostenstelle find it, not each of its Kategorien
  assert.deepEqual(
    search('stammeslager 2026').matches.map((m) => m.gruppe),
    ['Kostenstellen']
  );
});

test('a suggestion fills the Kostenstelle in, a Kategorie also its own', () => {
  const [unit, category] = [
    ...zuordnungVorschlaege(UNITS, 'leitendenlager'),
    ...zuordnungVorschlaege(UNITS, 'runde'),
  ];
  assert.deepEqual(
    [unit?.value, category?.value, category?.label],
    ['Leitendenlager 2026', 'Allgemein', 'Leitendenrunde']
  );
  assert.deepEqual(zuordnungTreffer(UNITS, category!), {
    kostenstelle: 'Allgemein',
    kategorie: 'Leitendenrunde',
  });
});
