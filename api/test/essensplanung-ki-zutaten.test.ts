import assert from 'node:assert/strict';
import test from 'node:test';
import type { KiZutatEingabe, KiZutatListen } from '../lib/essen-ki-zutaten-antwort';
import { kiZutatenAnfrage, leseKiZutaten, readKiZutatIds } from '../lib/essen-ki-zutaten-antwort';
import { kiPortionen } from '../lib/essen-ki-zutaten-model';
import { fields } from './fixtures/essen-fields';

const LISTEN: KiZutatListen = {
  kategorien: [
    { id: 1, name: 'Sonstiges' },
    { id: 2, name: 'Gewürze' },
    { id: 3, name: 'Nudeln & Reis' },
  ],
  unvertraeglichkeiten: [
    { id: 10, name: 'Gluten' },
    { id: 11, name: 'Milch' },
  ],
};

function eingabe(
  id: number,
  name: string,
  werte: Partial<KiZutatEingabe['werte']> = {},
  zentral = false
): KiZutatEingabe {
  return {
    schluessel: `${zentral ? 'z' : 'p'}${id}`,
    id,
    etag: `e${id}`,
    zentral,
    werte: {
      name,
      kategorieId: 1,
      einheitenart: 'stueck',
      lebensmittel: true,
      vegetarisch: null,
      vegan: null,
      allergene: [],
      grammProTl: null,
      grammProEl: null,
      grammProStueck: null,
      ...werte,
    },
  };
}

function antwort(schluessel: string, patch: Record<string, unknown> = {}) {
  return {
    schluessel,
    verstanden: true,
    grund: '',
    name: '',
    kategorie: null,
    einheitenart: 'stueck',
    lebensmittel: true,
    vegetarisch: null,
    vegan: null,
    allergene: [],
    gramm_pro_tl: null,
    gramm_pro_el: null,
    gramm_pro_stueck: null,
    begruendung: '',
    ...patch,
  };
}

test('KI Zutaten: proposals, unclear names and left out ones each get a result', () => {
  const eingaben = [
    eingabe(1, 'Spagetti'),
    eingabe(2, 'Omas Zeug'),
    eingabe(3, 'Salz', { kategorieId: 2, einheitenart: 'masse', vegetarisch: true, vegan: true }),
    eingabe(4, 'Vergessen'),
  ];
  const ergebnis = leseKiZutaten(
    {
      zutaten: [
        antwort('p1', {
          name: 'Spaghetti',
          kategorie: 'nudeln & reis',
          einheitenart: 'masse',
          vegetarisch: false,
          vegan: true,
          allergene: ['Gluten', 'Unbekannt', 'Gluten'],
          begruendung: 'Hartweizennudeln.',
        }),
        antwort('p2', { verstanden: false, grund: 'Unklar, was gemeint ist.' }),
        antwort('p3', {
          name: 'Salz',
          kategorie: 'Gewürze',
          einheitenart: 'masse',
          vegetarisch: true,
          vegan: true,
        }),
        antwort('p99'),
        'kaputt',
      ],
    },
    eingaben,
    LISTEN
  );
  assert.deepEqual(
    ergebnis.ergebnisse.map((e) => [e.id, e.etag, e.status]),
    [
      [1, 'e1', 'vorschlag'],
      [2, 'e2', 'unklar'],
      [3, 'e3', 'passt'],
      [4, 'e4', 'ohne_antwort'],
    ]
  );
  const [spaghetti, unklar] = ergebnis.ergebnisse;
  // Vegan includes vegetarian
  assert.deepEqual(spaghetti.vorschlag, {
    ...eingaben[0].werte,
    name: 'Spaghetti',
    kategorieId: 3,
    einheitenart: 'masse',
    vegetarisch: true,
    vegan: true,
    allergene: [10],
  });
  assert.deepEqual(
    spaghetti.aenderungen.map((a) => `${a.label}: ${a.alt} → ${a.neu}`),
    [
      'Name: Spagetti → Spaghetti',
      'Kategorie: Sonstiges → Nudeln & Reis',
      'Gemessen in: Stück → Gewicht (g/kg)',
      'Ernährung: unbekannt → vegan',
      'Enthält: keine → Gluten',
    ]
  );
  assert.equal(spaghetti.text, 'Hartweizennudeln.');
  assert.deepEqual(
    [unklar.text, unklar.vorschlag, unklar.aenderungen],
    ['Unklar, was gemeint ist.', null, []]
  );
  assert.throws(() => leseKiZutaten({ nichts: [] }, eingaben, LISTEN));
});

test('KI Zutaten: own ingredients keep food and conversion; central ones get grams in range', () => {
  const eigene = eingabe(1, 'Mehl', { einheitenart: 'masse' });
  const zentral = eingabe(
    2,
    'Zucker',
    { einheitenart: 'masse', grammProTl: 4, grammProEl: null, grammProStueck: null },
    true
  );
  const ergebnis = leseKiZutaten(
    {
      zutaten: [
        antwort('p1', { einheitenart: 'masse', lebensmittel: false, gramm_pro_tl: 3 }),
        antwort('z2', {
          einheitenart: 'masse',
          gramm_pro_tl: 5,
          gramm_pro_el: 12.34,
          gramm_pro_stueck: 200_000,
        }),
      ],
    },
    [eigene, zentral],
    LISTEN
  );
  assert.equal(ergebnis.ergebnisse[0].status, 'passt');
  const zucker = ergebnis.ergebnisse[1];
  // 5 g is near the stored 4 g, the piece is out of range
  assert.deepEqual(
    [zucker.vorschlag?.grammProTl, zucker.vorschlag?.grammProEl, zucker.vorschlag?.grammProStueck],
    [4, 12, null]
  );
  // A central one that is no food loses diet and allergens
  const kein = leseKiZutaten(
    { zutaten: [antwort('z2', { lebensmittel: false, einheitenart: 'masse', vegan: true })] },
    [{ ...zentral, werte: { ...zentral.werte, vegetarisch: true, allergene: [10] } }],
    LISTEN
  ).ergebnisse[0];
  assert.deepEqual(
    [
      kein.vorschlag?.lebensmittel,
      kein.vorschlag?.vegetarisch,
      kein.vorschlag?.vegan,
      kein.vorschlag?.allergene,
    ],
    [false, null, null, []]
  );
});

test('KI Zutaten: the question names categories and allergens, open ones without category', () => {
  const anfrage = kiZutatenAnfrage(
    [eingabe(1, 'Paste', { allergene: [11] }), eingabe(2, 'Zucker', {}, true)],
    LISTEN,
    new Set(['p1'])
  );
  assert.deepEqual(anfrage.kategorien, ['Sonstiges', 'Gewürze', 'Nudeln & Reis']);
  assert.deepEqual(anfrage.zutaten[0], {
    schluessel: 'p1',
    name: 'Paste',
    angaben_offen: true,
    kategorie: null,
    einheitenart: 'stueck',
    lebensmittel: true,
    vegetarisch: null,
    vegan: null,
    allergene: ['Milch'],
  });
  assert.equal(anfrage.zutaten[1].kategorie, 'Sonstiges');
  assert.ok('gramm_pro_tl' in anfrage.zutaten[1]);
});

test('KI Zutaten: ids are 1 to 25 positive whole numbers, sent in portions', () => {
  assert.deepEqual(readKiZutatIds({ ids: [3, 1, 3] }), [3, 1]);
  for (const ids of [undefined, [], [0], ['1'], [1.5]])
    assert.deepEqual(
      fields(() => readKiZutatIds({ ids })),
      { ids: 'Bitte Zutaten zum Prüfen wählen.' }
    );
  assert.deepEqual(
    fields(() => readKiZutatIds({ ids: Array.from({ length: 26 }, (_, i) => i + 1) })),
    { ids: 'Höchstens 25 Zutaten auf einmal.' }
  );
  assert.deepEqual(kiPortionen([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('KI Zutaten: guessed details the AI confirms are a proposal, so the mark goes', () => {
  const offen = { ...eingabe(1, 'Paste'), angabenOffen: true };
  const [ergebnis] = leseKiZutaten({ zutaten: [antwort('p1')] }, [offen], LISTEN).ergebnisse;
  assert.equal(ergebnis.status, 'vorschlag');
  assert.deepEqual(ergebnis.vorschlag, offen.werte);
  assert.deepEqual(
    ergebnis.aenderungen.map((a) => `${a.label}: ${a.alt} → ${a.neu}`),
    ['Angaben: geraten → bestätigt']
  );
});
