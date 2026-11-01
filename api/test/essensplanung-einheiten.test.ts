import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import * as azureOpenai from '../lib/azure-openai';
import type { EinheitenStand } from '../lib/essen-einheiten-model';
import {
  einheitenVorkommen,
  rundeMenge,
  sichererFaktor,
  uneinheitlicheZutaten,
} from '../lib/essen-einheiten-model';
import { validateEinheiten } from '../lib/essen-einheiten-schema';
import { einheitFeld } from '../lib/essen-einheit-schema';
import {
  einheitSchluessel,
  einheitText,
  einheitenGleicherBasis,
  normalisiereEinheit,
} from '../lib/essen-gerichte-model';
import { schlageEinheitenVor } from '../lib/essen-ki-einheiten';
import { ValidationError } from '../lib/validation/errors';

/** Units of one's own and bringing the units of an ingredient into line. */

test('typed units are stored as known keys, kitchen spellings or as typed', () => {
  assert.equal(normalisiereEinheit(' Stück '), 'stueck');
  assert.equal(normalisiereEinheit('KG'), 'kg');
  assert.equal(normalisiereEinheit('g (ATG)'), 'g');
  assert.equal(normalisiereEinheit('Gramm'), 'g');
  assert.equal(normalisiereEinheit('el'), 'EL');
  assert.equal(normalisiereEinheit('Esslöffel'), 'EL');
  assert.equal(normalisiereEinheit('Dosen'), 'Dose');
  assert.equal(normalisiereEinheit('  kleine   Schale '), 'kleine Schale');
  assert.equal(normalisiereEinheit('   '), null);
  assert.equal(einheitText('stueck'), 'Stück');
  assert.equal(einheitText('Dose'), 'Dose');
  assert.equal(einheitText('kg', true), 'kg (ATG)');
});

test("kg and g share a base, units of one's own are a base of their own", () => {
  assert.equal(einheitSchluessel('kg'), 'g');
  assert.equal(einheitSchluessel('Schale'), 'schale');
  assert.equal(einheitSchluessel('schale'), 'schale');
  assert.deepEqual(einheitenGleicherBasis('l'), ['ml', 'l']);
  assert.deepEqual(einheitenGleicherBasis('Dose'), ['Dose']);
  assert.equal(sichererFaktor('kg', 'g'), 1000);
  assert.equal(sichererFaktor('g', 'kg'), 0.001);
  assert.equal(sichererFaktor('Bund', 'g'), null);
  assert.equal(rundeMenge(0.333333, 'Bund'), 0.33);
  assert.equal(rundeMenge(59.6, 'g'), 60);
  assert.equal(rundeMenge(1.23456, 'kg'), 1.235);
});

test('the unit field takes any short text and refuses long ones', () => {
  assert.equal(einheitFeld.parse('Becher'), 'Becher');
  assert.equal(einheitFeld.parse('Liter'), 'l');
  assert.equal(einheitFeld.parse(''), null);
  assert.equal(einheitFeld.parse(7), null);
  assert.equal(einheitFeld.safeParse('x'.repeat(21)).success, false);
});

test('converted amounts are checked per line', () => {
  const zeile = {
    stelle: 'gericht',
    id: 3,
    etag: 'AAAAAAAAB9E=',
    menge: 1.23456,
    einheit: 'Bund',
    von: 'g',
  };
  assert.deepEqual(validateEinheiten({ zeilen: [zeile] }), [
    { ...zeile, menge: 1.235, einheit: 'bund', von: 'g' },
  ]);
  assert.throws(
    () => validateEinheiten({ zeilen: [{ ...zeile, menge: 0, einheit: '' }] }),
    (error: unknown) =>
      error instanceof ValidationError &&
      error.fields['zeilen.0.menge'] === 'Bitte eine Menge größer als 0 eintragen, z. B. 2,5.' &&
      error.fields['zeilen.0.einheit'] === 'Bitte eine Einheit wählen.'
  );
  assert.throws(
    () => validateEinheiten({ zeilen: [] }),
    (error: unknown) =>
      error instanceof ValidationError &&
      error.fields.zeilen === 'Bitte mindestens eine Menge umrechnen.'
  );
});

const STAND: EinheitenStand = {
  gerichte: [
    {
      id: 9,
      name: 'Kräuterquark',
      personen: 10,
      zutaten: [
        {
          id: 1,
          etag: 'z1',
          position: 1,
          planungZutatId: 7,
          menge: 3,
          einheit: 'bund',
          fest: false,
          fuerAlles: true,
          fuerVegetarisch: true,
          fuerVegan: true,
          ohne: [],
          nur: [],
          hinweis: '',
        },
        {
          id: 2,
          etag: 'z2',
          position: 2,
          planungZutatId: 8,
          menge: null,
          einheit: null,
          fest: false,
          fuerAlles: true,
          fuerVegetarisch: true,
          fuerVegan: true,
          ohne: [],
          nur: [],
          hinweis: '',
        },
      ],
    },
  ],
  zusatzbedarf: [{ id: 4, etag: 'p4', planungZutatId: 7, menge: 200, einheit: 'g' }],
  bestand: [
    { id: 5, etag: 'b5', planungZutatId: 7, menge: 0.1, einheit: 'kg' },
    { id: 6, etag: 'b6', planungZutatId: 8, menge: 1, einheit: 'kg' },
  ],
};

test('ingredients in more than one base unit are found, with every amount', () => {
  assert.deepEqual([...uneinheitlicheZutaten(STAND)], [[7, ['bund', 'g']]]);
  assert.deepEqual(
    einheitenVorkommen(STAND, 7).map(({ stelle, id, einheit, wo }) => ({
      stelle,
      id,
      einheit,
      wo,
    })),
    [
      { stelle: 'gericht', id: 1, einheit: 'bund', wo: 'Kräuterquark' },
      { stelle: 'zusatzbedarf', id: 4, einheit: 'g', wo: 'Zusatzbedarf' },
      { stelle: 'bestand', id: 5, einheit: 'kg', wo: 'Bestand' },
    ]
  );
});

function modell(t: TestContext, antwort: unknown): { messages: unknown }[] {
  const gesendet: { messages: unknown }[] = [];
  t.mock.method(
    azureOpenai,
    'requestStructuredOutput',
    async (_config: unknown, request: { messages: unknown }) => {
      gesendet.push(request);
      return antwort;
    }
  );
  return gesendet;
}

test('the AI proposes a unit; certain factors are worked out, wrong ones dropped', async (t) => {
  const gesendet = modell(t, {
    ziel: 'Bund',
    begruendung: 'Kräuter kauft man im Bund, einer wiegt etwa 20 g.',
    faktoren: [
      { einheit: 'Bund', faktor: 3 },
      { einheit: 'g', faktor: 0.05 },
      { einheit: 'kg', faktor: -1 },
    ],
  });
  const vorschlag = await schlageEinheitenVor(
    7,
    'TK-Petersilie',
    'masse',
    einheitenVorkommen(STAND, 7)
  );
  assert.deepEqual(vorschlag, {
    planungZutatId: 7,
    ziel: 'bund',
    begruendung: 'Kräuter kauft man im Bund, einer wiegt etwa 20 g.',
    faktoren: [
      // The target itself is 1, whatever the model says
      { einheit: 'bund', faktor: 1 },
      { einheit: 'g', faktor: 0.05 },
      { einheit: 'kg', faktor: null },
    ],
  });
  const text = JSON.stringify(gesendet[0].messages);
  assert.match(text, /TK-Petersilie/);
  assert.match(text, /Kräuterquark/);
});
