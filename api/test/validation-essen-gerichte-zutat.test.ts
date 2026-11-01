import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGerichtZutat, validatePlanungZutat } from '../lib/essen-gerichte-validation';
import { fields } from './fixtures/essen-fields';

const MENGE_UNGUELTIG = 'Bitte eine Menge größer als 0 eintragen oder leer lassen.';
const LISTE = 'Bitte aus der Liste wählen.';

const ZEILE = {
  zutatId: 4,
  menge: 250,
  einheit: 'g',
  fest: false,
  fuerAlles: true,
  fuerVegetarisch: true,
  fuerVegan: true,
  ohne: [],
  nur: [],
  hinweis: '',
};

function zeile(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...ZEILE, ...patch };
}

function zeileFehler(patch: Record<string, unknown>): Record<string, string> {
  return fields(() => validateGerichtZutat(zeile(patch)));
}

test('Zeile: a valid line of a central ingredient', () => {
  assert.deepEqual(validateGerichtZutat(ZEILE), {
    zutat: { zutatId: 4 },
    menge: 250,
    einheit: 'g',
    fest: false,
    fuerAlles: true,
    fuerVegetarisch: true,
    fuerVegan: true,
    ohne: [],
    nur: [],
    hinweis: '',
  });
});

test('Zeile: the defaults of a line with only an ingredient', () => {
  assert.deepEqual(validateGerichtZutat({ planungZutatId: 9 }), {
    zutat: { planungZutatId: 9 },
    menge: null,
    einheit: null,
    fest: false,
    fuerAlles: true,
    fuerVegetarisch: true,
    fuerVegan: true,
    ohne: [],
    nur: [],
    hinweis: '',
  });
  // The central ingredient wins over one of the Planung
  assert.deepEqual(validateGerichtZutat({ zutatId: 1, planungZutatId: 2 }).zutat, { zutatId: 1 });
  assert.deepEqual(validateGerichtZutat({ zutatId: 0, planungZutatId: 2 }).zutat, {
    planungZutatId: 2,
  });
});

test('Zeile: without a valid ingredient the line is refused', () => {
  const expected = { zutat: 'Bitte eine Zutat wählen.' };
  for (const input of [undefined, null, 'x', [], {}, { zutatId: '4' }, { zutatId: 1.5 }]) {
    assert.deepEqual(
      fields(() => validateGerichtZutat(input)),
      expected
    );
  }
  for (const id of [0, -1, 2.5, '3', NaN, null, true]) {
    assert.deepEqual(zeileFehler({ zutatId: id }), expected, String(id));
  }
  assert.deepEqual(zeileFehler({ zutatId: undefined, planungZutatId: -1 }), expected);
});

test('Zeile: the amount is rounded to three decimals and needs a unit', () => {
  const menge = (value: unknown): unknown => validateGerichtZutat(zeile({ menge: value })).menge;
  assert.equal(menge(1.23456), 1.235);
  assert.equal(menge(0.0004), 0.001);
  assert.equal(menge(1_000_000), 1_000_000);
  for (const leer of [null, undefined, '']) {
    const result = validateGerichtZutat(zeile({ menge: leer, einheit: 'kg', fest: true }));
    assert.deepEqual([result.menge, result.einheit, result.fest], [null, null, false]);
  }
  assert.equal(validateGerichtZutat(zeile({ fest: true })).fest, true);
  assert.equal(validateGerichtZutat(zeile({ fest: 'ja' })).fest, false);
});

test('Zeile: an invalid amount or unit', () => {
  for (const menge of [0, -1, '5', true, NaN, Infinity, {}, [1]]) {
    assert.deepEqual(zeileFehler({ menge }), { menge: MENGE_UNGUELTIG }, String(menge));
  }
  assert.deepEqual(zeileFehler({ menge: 1_000_001 }), { menge: 'Die Menge ist zu groß.' });
  for (const einheit of [undefined, null, 5, '', '   ']) {
    assert.deepEqual(zeileFehler({ einheit }), { einheit: 'Bitte eine Einheit wählen.' });
  }
  assert.deepEqual(zeileFehler({ menge: 0, einheit: '' }), {
    menge: MENGE_UNGUELTIG,
    einheit: 'Bitte eine Einheit wählen.',
  });
  for (const einheit of ['g', 'kg', 'ml', 'l', 'stueck', 'packung', 'bund']) {
    assert.equal(validateGerichtZutat(zeile({ einheit })).einheit, einheit);
  }
  // Any unit of one's own; known ones in another spelling become their key
  assert.equal(validateGerichtZutat(zeile({ einheit: ' Dose ' })).einheit, 'Dose');
  assert.equal(validateGerichtZutat(zeile({ einheit: 'Kg' })).einheit, 'kg');
  assert.deepEqual(zeileFehler({ einheit: 'x'.repeat(21) }), {
    einheit: 'Die Einheit darf höchstens 20 Zeichen lang sein.',
  });
});

test('Zeile: a line applies to at least one way of eating', () => {
  const keine = { fuerAlles: false, fuerVegetarisch: false, fuerVegan: false };
  assert.deepEqual(zeileFehler(keine), {
    fuer: 'Die Zeile muss für mindestens eine Ernährungsform gelten.',
  });
  const vegan = validateGerichtZutat(zeile({ ...keine, fuerVegan: 0 }));
  assert.deepEqual([vegan.fuerAlles, vegan.fuerVegetarisch, vegan.fuerVegan], [false, false, true]);
  const nurVegan = validateGerichtZutat(zeile({ ...keine, fuerVegan: true }));
  assert.deepEqual(
    [nurVegan.fuerAlles, nurVegan.fuerVegetarisch, nurVegan.fuerVegan],
    [false, false, true]
  );
});

test('Zeile: ohne and nur are sorted lists of positive whole numbers without duplicates', () => {
  const result = validateGerichtZutat(zeile({ ohne: [5, 2, 5, 9], nur: [1] }));
  assert.deepEqual([result.ohne, result.nur], [[2, 5, 9], [1]]);
  assert.deepEqual(validateGerichtZutat(zeile({ ohne: undefined })).ohne, []);
  for (const ids of [
    null,
    'x',
    {},
    3,
    [0],
    [1.5],
    ['1'],
    [null],
    Array.from({ length: 31 }, (_, i) => i + 1),
  ]) {
    assert.deepEqual(zeileFehler({ ohne: ids }), { ohne: LISTE });
    assert.deepEqual(zeileFehler({ nur: ids }), { nur: LISTE });
  }
  assert.equal(
    validateGerichtZutat(zeile({ nur: Array.from({ length: 30 }, (_, i) => i + 1) })).nur.length,
    30
  );
});

test('Zeile: an intolerance cannot be both ohne and nur', () => {
  assert.deepEqual(zeileFehler({ ohne: [1, 2], nur: [2, 3] }), {
    nur: 'Eine Unverträglichkeit kann nicht zugleich „nicht für“ und „nur für“ sein.',
  });
  const frei = validateGerichtZutat(zeile({ ohne: [1], nur: [2] }));
  assert.deepEqual([frei.ohne, frei.nur], [[1], [2]]);
});

test('Zeile: the hint is trimmed and has at most 100 characters', () => {
  assert.equal(
    validateGerichtZutat(zeile({ hinweis: '  gut   abtropfen ' })).hinweis,
    'gut abtropfen'
  );
  assert.equal(validateGerichtZutat(zeile({ hinweis: 4 })).hinweis, '');
  assert.equal(validateGerichtZutat(zeile({ hinweis: 'h'.repeat(100) })).hinweis.length, 100);
  assert.deepEqual(zeileFehler({ hinweis: 'h'.repeat(101) }), {
    hinweis: 'Höchstens 100 Zeichen.',
  });
});

test('Zeile: several faults report every field', () => {
  assert.deepEqual(
    fields(() =>
      validateGerichtZutat({
        menge: -1,
        fuerAlles: false,
        fuerVegetarisch: false,
        fuerVegan: false,
        ohne: 'x',
        nur: [0],
        hinweis: 'h'.repeat(101),
      })
    ),
    {
      zutat: 'Bitte eine Zutat wählen.',
      menge: MENGE_UNGUELTIG,
      einheit: 'Bitte eine Einheit wählen.',
      fuer: 'Die Zeile muss für mindestens eine Ernährungsform gelten.',
      ohne: LISTE,
      nur: LISTE,
      hinweis: 'Höchstens 100 Zeichen.',
    }
  );
});

const EIGENE = {
  name: 'Eigene Zutat',
  kategorieId: 2,
  einheitenart: 'volumen',
  vegetarisch: true,
  vegan: false,
  allergene: [3, 1],
};

test('Planung zutat: an own ingredient with all fields', () => {
  assert.deepEqual(validatePlanungZutat(EIGENE, { eigene: true }), {
    ...EIGENE,
    allergene: [1, 3],
  });
  assert.deepEqual(
    validatePlanungZutat(
      {
        ...EIGENE,
        name: '  Eigene   Zutat ',
        vegetarisch: 'x',
        vegan: undefined,
        allergene: undefined,
      },
      { eigene: true }
    ),
    { ...EIGENE, vegetarisch: null, vegan: null, allergene: [] }
  );
  // Vegan includes vegetarian
  assert.deepEqual(
    validatePlanungZutat({ ...EIGENE, vegetarisch: false, vegan: true }, { eigene: true }),
    { ...EIGENE, vegetarisch: true, vegan: true, allergene: [1, 3] }
  );
});

test('Planung zutat: an own ingredient needs name, category and kind of unit', () => {
  const expected = {
    name: 'Bitte einen Namen eintragen.',
    kategorieId: 'Bitte eine Kategorie wählen.',
    einheitenart: 'Bitte wählen, worin die Zutat gemessen wird.',
  };
  for (const input of [
    undefined,
    null,
    'x',
    [],
    {},
    { name: '  ', kategorieId: 0, einheitenart: 'x' },
  ]) {
    assert.deepEqual(
      fields(() => validatePlanungZutat(input, { eigene: true })),
      expected
    );
  }
  const fehler = (patch: Record<string, unknown>): Record<string, string> =>
    fields(() => validatePlanungZutat({ ...EIGENE, ...patch }, { eigene: true }));
  assert.deepEqual(fehler({ name: 'n'.repeat(151) }), { name: 'Höchstens 150 Zeichen.' });
  assert.deepEqual(fehler({ kategorieId: 1.5 }), { kategorieId: expected.kategorieId });
  assert.deepEqual(fehler({ einheitenart: 'Masse' }), { einheitenart: expected.einheitenart });
  for (const allergene of [null, 'x', [0], [1.5], Array.from({ length: 31 }, (_, i) => i + 1)]) {
    assert.deepEqual(fehler({ allergene }), { allergene: LISTE });
  }
  for (const art of ['masse', 'volumen', 'stueck', 'packung', 'bund']) {
    assert.equal(
      validatePlanungZutat({ ...EIGENE, einheitenart: art }, { eigene: true }).einheitenart,
      art
    );
  }
});

test('Planung zutat: the differences of a central ingredient never fail', () => {
  assert.deepEqual(
    validatePlanungZutat({ kategorieId: 3, einheitenart: 'masse' }, { eigene: false }),
    {
      kategorieId: 3,
      einheitenart: 'masse',
    }
  );
  for (const input of [undefined, null, 'x', [], {}, { kategorieId: 0, einheitenart: 'x' }]) {
    assert.deepEqual(validatePlanungZutat(input, { eigene: false }), {
      kategorieId: null,
      einheitenart: null,
    });
  }
  assert.deepEqual(validatePlanungZutat({ ...EIGENE, name: '', vegan: true }, { eigene: false }), {
    kategorieId: 2,
    einheitenart: 'volumen',
  });
});
