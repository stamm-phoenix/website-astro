import assert from 'node:assert/strict';
import test from 'node:test';
import { validateListName, validateZutat } from '../lib/essen-validation';
import { fields } from './fixtures/essen-fields';

const ZUTAT = {
  name: 'Mehl',
  kategorieId: 1,
  einheitenart: 'masse',
  abtropfgewicht: false,
  lebensmittel: true,
  vegetarisch: true,
  vegan: true,
  merkmaleGeprueft: true,
  hinweis: '',
  grammProTl: null,
  grammProEl: null,
  grammProStueck: null,
  allergene: [],
};

function zutat(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...ZUTAT, ...patch };
}

test('Zutat: a valid body is normalized', () => {
  assert.deepEqual(validateZutat(ZUTAT), ZUTAT);
  assert.deepEqual(
    validateZutat(
      zutat({
        name: '  Rote   Bohnen ',
        kategorieId: 3,
        einheitenart: 'masse',
        abtropfgewicht: true,
        vegetarisch: null,
        vegan: undefined,
        hinweis: '  ein  Hinweis ',
        grammProTl: 0.005,
        grammProEl: '',
        grammProStueck: 120.456,
        allergene: [2, 5],
      })
    ),
    {
      ...ZUTAT,
      name: 'Rote Bohnen',
      kategorieId: 3,
      abtropfgewicht: true,
      vegetarisch: null,
      vegan: null,
      hinweis: 'ein  Hinweis',
      grammProTl: 0.01,
      grammProEl: null,
      grammProStueck: 120.46,
      allergene: [2, 5],
    }
  );
  const spuelmittel = validateZutat(
    zutat({ name: 'Spülmittel', lebensmittel: false, einheitenart: 'stueck', allergene: [3] })
  );
  assert.equal(spuelmittel.vegetarisch, null);
  assert.equal(spuelmittel.vegan, null);
  assert.deepEqual(spuelmittel.allergene, []);
});

test('Zutat: something that is no object reports the required fields', () => {
  const expected = {
    name: 'Bitte einen Namen eintragen.',
    kategorieId: 'Bitte eine Kategorie wählen.',
    einheitenart: 'Bitte eine Einheit wählen.',
    lebensmittel: 'Bitte ja oder nein wählen.',
    abtropfgewicht: 'Bitte ja oder nein wählen.',
    merkmaleGeprueft: 'Bitte ja oder nein wählen.',
    allergene: 'Bitte eine Liste angeben.',
  };
  for (const body of [undefined, null, [], 'text'])
    assert.deepEqual(
      fields(() => validateZutat(body)),
      expected
    );
});

test('Zutat: every rule reports its message', () => {
  assert.deepEqual(
    fields(() =>
      validateZutat(
        zutat({
          name: 'x'.repeat(151),
          kategorieId: 1.5,
          einheitenart: 'liter',
          abtropfgewicht: true,
          lebensmittel: 'ja',
          vegetarisch: 'nein',
          vegan: 'x',
          merkmaleGeprueft: null,
          hinweis: 'x'.repeat(201),
          grammProTl: 1000.01,
          grammProEl: 0.001,
          grammProStueck: 100_000.01,
          allergene: 'gluten',
        })
      )
    ),
    {
      name: 'Höchstens 150 Zeichen.',
      kategorieId: 'Bitte eine Kategorie wählen.',
      einheitenart: 'Bitte eine Einheit wählen.',
      abtropfgewicht: 'Abtropfgewicht gibt es nur bei Gewicht (g/kg).',
      lebensmittel: 'Bitte ja oder nein wählen.',
      vegetarisch: 'Bitte ja, nein oder unbekannt wählen.',
      vegan: 'Bitte ja, nein oder unbekannt wählen.',
      merkmaleGeprueft: 'Bitte ja oder nein wählen.',
      hinweis: 'Höchstens 200 Zeichen.',
      grammProTl: 'Bitte eine Zahl von 0,01 bis 1.000 eintragen oder das Feld leer lassen.',
      grammProEl: 'Bitte eine Zahl von 0,01 bis 1.000 eintragen oder das Feld leer lassen.',
      grammProStueck: 'Bitte eine Zahl von 0,01 bis 100.000 eintragen oder das Feld leer lassen.',
      allergene: 'Bitte eine Liste angeben.',
    }
  );
  for (const wert of [0, 'x', Number.NaN, Infinity, -1, true]) {
    assert.deepEqual(Object.keys(fields(() => validateZutat(zutat({ grammProTl: wert })))), [
      'grammProTl',
    ]);
  }
  assert.equal(validateZutat(zutat({ grammProTl: 1000 })).grammProTl, 1000);
  assert.equal(validateZutat(zutat({ grammProStueck: 100_000 })).grammProStueck, 100_000);
  assert.equal(validateZutat(zutat({ grammProTl: 0.01 })).grammProTl, 0.01);
});

test('Zutat: names, categories and units', () => {
  assert.equal(
    fields(() => validateZutat(zutat({ name: ' ' }))).name,
    'Bitte einen Namen eintragen.'
  );
  assert.equal(
    fields(() => validateZutat(zutat({ name: 5 }))).name,
    'Bitte einen Namen eintragen.'
  );
  assert.equal(validateZutat(zutat({ name: 'x'.repeat(150) })).name.length, 150);
  for (const id of [0, -1, '1', null, Number.NaN])
    assert.equal(
      fields(() => validateZutat(zutat({ kategorieId: id }))).kategorieId,
      'Bitte eine Kategorie wählen.'
    );
  for (const art of ['masse', 'volumen', 'stueck', 'packung', 'bund'])
    assert.equal(validateZutat(zutat({ einheitenart: art })).einheitenart, art);
  assert.equal(
    fields(() => validateZutat(zutat({ einheitenart: undefined }))).einheitenart,
    'Bitte eine Einheit wählen.'
  );
  assert.deepEqual(
    fields(() => validateZutat(zutat({ einheitenart: 'volumen', abtropfgewicht: true }))),
    { abtropfgewicht: 'Abtropfgewicht gibt es nur bei Gewicht (g/kg).' }
  );
  assert.deepEqual(
    fields(() => validateZutat(zutat({ einheitenart: 'liter', abtropfgewicht: true }))),
    {
      einheitenart: 'Bitte eine Einheit wählen.',
      abtropfgewicht: 'Abtropfgewicht gibt es nur bei Gewicht (g/kg).',
    }
  );
});

test('Zutat: vegan implies vegetarisch; unknown stays null', () => {
  assert.deepEqual(
    fields(() => validateZutat(zutat({ vegetarisch: false, vegan: true }))),
    {
      vegan: 'Was vegan ist, ist auch vegetarisch.',
    }
  );
  assert.deepEqual(
    fields(() => validateZutat(zutat({ vegetarisch: null, vegan: true }))),
    {
      vegan: 'Was vegan ist, ist auch vegetarisch.',
    }
  );
  assert.deepEqual(
    fields(() => validateZutat(zutat({ vegetarisch: 'x', vegan: true }))),
    {
      vegetarisch: 'Bitte ja, nein oder unbekannt wählen.',
      vegan: 'Was vegan ist, ist auch vegetarisch.',
    }
  );
  assert.deepEqual(
    fields(() => validateZutat(zutat({ vegetarisch: true, vegan: 'x' }))),
    {
      vegan: 'Bitte ja, nein oder unbekannt wählen.',
    }
  );
  const unknown = validateZutat(zutat({ vegetarisch: null, vegan: null }));
  assert.equal(unknown.vegetarisch, null);
  assert.equal(unknown.vegan, null);
  assert.equal(validateZutat(zutat({ vegetarisch: true, vegan: false })).vegan, false);
  assert.equal(validateZutat(zutat({ vegetarisch: false, vegan: null })).vegetarisch, false);
});

test('Zutat: allergens are positive whole numbers, a repeated one is invalid', () => {
  assert.deepEqual(
    fields(() => validateZutat(zutat({ allergene: [1, 1] }))),
    {
      allergene: 'Ungültige Auswahl.',
    }
  );
  for (const ids of [[0], [-1], [1.5], ['1'], [null], [1, 'x'], [Number.NaN]])
    assert.deepEqual(
      fields(() => validateZutat(zutat({ allergene: ids }))),
      { allergene: 'Ungültige Auswahl.' },
      JSON.stringify(ids)
    );
  for (const ids of [undefined, null, {}, 'a'])
    assert.deepEqual(
      fields(() => validateZutat(zutat({ allergene: ids }))),
      {
        allergene: 'Bitte eine Liste angeben.',
      }
    );
  assert.deepEqual(validateZutat(zutat({ allergene: [] })).allergene, []);
  assert.deepEqual(validateZutat(zutat({ allergene: [4, 2] })).allergene, [4, 2]);
});

test('Zutat: a hint is trimmed and may be missing', () => {
  assert.equal(validateZutat(zutat({ hinweis: undefined })).hinweis, '');
  assert.equal(validateZutat(zutat({ hinweis: 5 })).hinweis, '');
  assert.equal(validateZutat(zutat({ hinweis: ` ${'x'.repeat(200)} ` })).hinweis.length, 200);
});

test('list names are trimmed and limited to 100 characters', () => {
  assert.equal(validateListName({ name: '  Milch   und  Eier ' }), 'Milch und Eier');
  assert.equal(validateListName({ name: 'x'.repeat(100) }).length, 100);
  assert.deepEqual(
    fields(() => validateListName({ name: 'x'.repeat(101) })),
    { name: 'Höchstens 100 Zeichen.' }
  );
  for (const body of [{}, { name: ' ' }, { name: 5 }, null, [], 'text', undefined])
    assert.deepEqual(
      fields(() => validateListName(body)),
      { name: 'Bitte einen Namen eintragen.' }
    );
});
