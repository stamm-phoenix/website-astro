import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  kategorieVorschlaege,
  readZuordnungTreffer,
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
  const { matches } = filterVorschlaege(zuordnungVorschlaege(UNITS), 'leite', 20);
  assert.deepEqual(
    matches.map((m) => [m.gruppe, readZuordnungTreffer(m.value)]),
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
