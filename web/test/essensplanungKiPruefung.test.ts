import assert from 'node:assert/strict';
import test from 'node:test';
import type { GerichtZutat } from '../../api/lib/essen-gerichte-model.ts';
import {
  aenderungBody,
  aenderungText,
  geprueftText,
  neueZeileBody,
  neueZeileText,
  werkzeugText,
  werkzeugeNach,
  type KiNeueZeile,
  type KiPruefung,
} from '../src/lib/essensplanungKiPruefung.ts';

const ZEILE: GerichtZutat = {
  id: 31,
  etag: 'z-31',
  position: 1,
  planungZutatId: 11,
  menge: 500,
  einheit: 'g',
  fest: false,
  fuerAlles: true,
  fuerVegetarisch: true,
  fuerVegan: false,
  ohne: [7],
  nur: [],
  hinweis: '',
};

test('a proposed change of a line says what it does', () => {
  assert.equal(
    aenderungText({ menge: 1000, einheit: 'g', fuerVegetarisch: false }),
    '1.000 g, nicht für vegetarisch'
  );
  assert.equal(
    aenderungText(
      { zutat: { wahl: { zutatId: 3 }, name: 'Vollkornnudeln' }, hinweis: 'al dente' },
      { name: 'Spaghetti' }
    ),
    'Vollkornnudeln statt Spaghetti, Hinweis „al dente“'
  );
  assert.equal(aenderungText({ hinweis: '' }), 'ohne Hinweis');
});

test('taking over a change sends the whole line with the version that was checked', () => {
  assert.deepEqual(aenderungBody(ZEILE, { menge: 1, einheit: 'kg' }, 'z-31-geprueft'), {
    etag: 'z-31-geprueft',
    planungZutatId: 11,
    menge: 1,
    einheit: 'kg',
    fest: false,
    fuerAlles: true,
    fuerVegetarisch: true,
    fuerVegan: false,
    ohne: [7],
    nur: [],
    hinweis: '',
  });
  // Another ingredient replaces the line's own: of the list by id, else a new one by name
  const zentral = aenderungBody(ZEILE, { zutat: { wahl: { zutatId: 3 }, name: 'Tofu' } }, 'e');
  assert.equal(zentral.zutatId, 3);
  assert.equal('planungZutatId' in zentral, false);
  const neu = aenderungBody(ZEILE, { zutat: { wahl: null, name: 'Räuchertofu' } }, 'e');
  assert.equal(neu.neueZutat, 'Räuchertofu');
  assert.equal('planungZutatId' in neu, false);
  // One of the Planung keeps its name, in case it went meanwhile
  const eigene = aenderungBody(
    ZEILE,
    { zutat: { wahl: { planungZutatId: 12 }, name: 'Hack' } },
    'e'
  );
  assert.equal(eigene.planungZutatId, 12);
  assert.equal(eigene.neueZutat, 'Hack');
});

test('a line to add is named and sent like a recipe line', () => {
  const salz: KiNeueZeile = {
    zutat: { wahl: { zutatId: 6 }, name: 'Salz' },
    menge: 20,
    einheit: 'g',
    fest: true,
    fuerAlles: true,
    fuerVegetarisch: true,
    fuerVegan: true,
    hinweis: 'nach Geschmack',
  };
  assert.equal(neueZeileText(salz), '20 g Salz, feste Menge, nach Geschmack');
  assert.equal(
    neueZeileText({
      ...salz,
      zutat: { wahl: null, name: 'Basilikum' },
      menge: null,
      einheit: null,
      fest: false,
      hinweis: '',
    }),
    'Basilikum, nach Gefühl'
  );
  assert.deepEqual(neueZeileBody(salz), {
    zutatId: 6,
    menge: 20,
    einheit: 'g',
    fest: true,
    fuerAlles: true,
    fuerVegetarisch: true,
    fuerVegan: true,
    hinweis: 'nach Geschmack',
  });
});

test('a change of the tools only applies while it still fits them', () => {
  const werkzeuge = ['Topf 10 l', 'Sieb'];
  assert.deepEqual(werkzeugeNach(werkzeuge, { alt: null, neu: 'Kelle' }), [
    'Topf 10 l',
    'Sieb',
    'Kelle',
  ]);
  assert.deepEqual(werkzeugeNach(werkzeuge, { alt: 'topf 10 L', neu: 'Topf 30 l' }), [
    'Topf 30 l',
    'Sieb',
  ]);
  assert.deepEqual(werkzeugeNach(werkzeuge, { alt: 'Sieb', neu: null }), ['Topf 10 l']);
  // Gone meanwhile, or there already
  assert.equal(werkzeugeNach(['Sieb'], { alt: 'Topf 10 l', neu: 'Topf 30 l' }), null);
  assert.equal(werkzeugeNach(werkzeuge, { alt: null, neu: 'sieb' }), null);
  assert.equal(werkzeugeNach(werkzeuge, { alt: 'Sieb', neu: 'Topf 10 l' }), null);
  // At most 30 tools
  const viele = Array.from({ length: 30 }, (_, i) => `Werkzeug ${i}`);
  assert.equal(werkzeugeNach(viele, { alt: null, neu: 'Kelle' }), null);

  assert.equal(werkzeugText({ alt: null, neu: 'Kelle' }), 'Werkzeug „Kelle“ hinzufügen');
  assert.equal(werkzeugText({ alt: 'Sieb', neu: null }), 'Werkzeug „Sieb“ entfernen');
  assert.equal(
    werkzeugText({ alt: 'Topf 10 l', neu: 'Topf 30 l' }),
    'Werkzeug „Topf 10 l“ durch „Topf 30 l“ ersetzen'
  );
});

test('the result says for how many people it was checked', () => {
  const pruefung: KiPruefung = {
    einschaetzung: '',
    hinweise: [],
    personen: 10,
    geprueftFuer: 10,
    personenQuelle: 'gericht',
    anleitungGeprueft: true,
    etag: 'g',
  };
  assert.equal(geprueftText(pruefung), 'Geprüft für 10 Personen.');
  assert.equal(
    geprueftText({
      ...pruefung,
      personen: null,
      geprueftFuer: 40,
      personenQuelle: 'anwesend',
      anleitungGeprueft: false,
    }),
    'Geprüft für 40 Personen, die bei der Mahlzeit da sind, ohne Anleitung.'
  );
  assert.equal(
    geprueftText({ ...pruefung, personen: null, geprueftFuer: null, personenQuelle: null }),
    'Geprüft ohne Personenzahl.'
  );
});
