import assert from 'node:assert/strict';
import test from 'node:test';
import { leseKiZutaten } from '../lib/essen-ki-zutaten-antwort';
import { angabenListe, angabenStand, angabenText } from '../lib/essen-zutat-angaben';

/** The details the AI fills in for ingredients added by their name alone, without database. */

const LISTEN = {
  kategorien: [
    { id: 1, name: 'Gemüse' },
    { id: 2, name: 'Sonstiges' },
  ],
  unvertraeglichkeiten: [
    { id: 7, name: 'Gluten', schluessel: 'gluten' },
    { id: 8, name: 'Laktose', schluessel: 'laktose' },
  ],
};

test('the answer counts only for asked ingredients, ids of the lists and known words', () => {
  const angaben = leseKiZutaten(
    {
      zutaten: [
        {
          schluessel: 'z5',
          kategorie: 1,
          einheitenart: 'stueck',
          ernaehrung: 'vegan',
          allergene: [],
        },
        // The first entry per key counts
        {
          schluessel: 'z5',
          kategorie: 2,
          einheitenart: 'masse',
          ernaehrung: 'fleisch',
          allergene: [],
        },
        {
          schluessel: 'z6',
          kategorie: 99,
          einheitenart: 'kiste',
          ernaehrung: 'vegetarisch',
          allergene: [8, 7, 8, 3, 'x'],
        },
        {
          schluessel: 'z7',
          kategorie: '1',
          einheitenart: null,
          ernaehrung: 'egal',
          allergene: [7],
        },
        {
          schluessel: 'z1',
          kategorie: 1,
          einheitenart: 'masse',
          ernaehrung: 'vegan',
          allergene: [],
        },
        'kaputt',
      ],
    },
    [5, 6, 7],
    LISTEN
  );
  assert.deepEqual(angaben, [
    {
      planungZutatId: 5,
      kategorieId: 1,
      einheitenart: 'stueck',
      vegetarisch: true,
      vegan: true,
      allergene: [],
    },
    {
      planungZutatId: 6,
      kategorieId: null,
      einheitenart: null,
      vegetarisch: true,
      vegan: false,
      allergene: [7, 8],
    },
    // An unknown diet says nothing about allergens either
    {
      planungZutatId: 7,
      kategorieId: null,
      einheitenart: null,
      vegetarisch: null,
      vegan: null,
      allergene: null,
    },
  ]);
  assert.throws(() => leseKiZutaten({ antwort: [] }, [5], LISTEN));
});

test('open details are stored in a fixed order and read back leniently', () => {
  assert.equal(angabenText(['merkmale', 'kategorie']), 'kategorie,merkmale');
  assert.equal(angabenText([]), null);
  assert.deepEqual(angabenListe('merkmale,unbekannt,kategorie'), ['kategorie', 'merkmale']);
  assert.deepEqual(angabenListe(null), []);
  assert.equal(angabenStand('kategorie', false), 'offen');
  assert.equal(angabenStand(null, false), 'ki');
  assert.equal(angabenStand('', true), 'geprueft');
});
