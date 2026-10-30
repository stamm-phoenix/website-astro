import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../lib/validation/errors';
import { validateInventarArtikel, validateInventarZaehlung } from '../lib/validation/inventur';

const artikel = {
  bezeichnung: '  Stammespulli ',
  kategorie: 'kleidung',
  einheit: 'Stück',
  lagerort: 'Heimkeller',
  zustand: 'gut',
  varianten: [
    { id: null, bezeichnung: 'S', bestand: 4 },
    { id: 7, bezeichnung: 'M', bestand: 0 },
  ],
};

function fieldsOf(work: () => unknown): string[] {
  try {
    work();
  } catch (error: unknown) {
    if (error instanceof ValidationError) return Object.keys(error.fields).sort();
    throw error;
  }
  return [];
}

test('an article is trimmed and the optional texts default to empty', () => {
  const input = validateInventarArtikel(artikel);
  assert.equal(input.bezeichnung, 'Stammespulli');
  assert.equal(input.zubehoer, '');
  assert.equal(input.fehlend, '');
  assert.deepEqual(input.varianten[1], { id: 7, bezeichnung: 'M', bestand: 0 });
});

test('an article without name, unit or a valid category reports each field', () => {
  assert.deepEqual(
    fieldsOf(() =>
      validateInventarArtikel({ ...artikel, bezeichnung: ' ', einheit: '', kategorie: 'auto' })
    ),
    ['bezeichnung', 'einheit', 'kategorie']
  );
  assert.deepEqual(
    fieldsOf(() => validateInventarArtikel(null)),
    ['bezeichnung', 'einheit', 'kategorie', 'varianten', 'zustand']
  );
});

test('stock must be a whole number from zero', () => {
  for (const bestand of [-1, 2.5, '3', null, 2_000_000]) {
    assert.deepEqual(
      fieldsOf(() =>
        validateInventarArtikel({ ...artikel, varianten: [{ id: null, bezeichnung: '', bestand }] })
      ),
      ['varianten'],
      String(bestand)
    );
  }
});

test('several variants need distinct names, a single one may be unnamed', () => {
  const single = validateInventarArtikel({
    ...artikel,
    varianten: [{ id: null, bezeichnung: '', bestand: 3 }],
  });
  assert.equal(single.varianten[0].bezeichnung, '');
  assert.deepEqual(
    fieldsOf(() =>
      validateInventarArtikel({
        ...artikel,
        varianten: [
          { id: null, bezeichnung: '', bestand: 1 },
          { id: null, bezeichnung: 'M', bestand: 1 },
        ],
      })
    ),
    ['varianten']
  );
  assert.deepEqual(
    fieldsOf(() =>
      validateInventarArtikel({
        ...artikel,
        varianten: [
          { id: null, bezeichnung: 'm', bestand: 1 },
          { id: null, bezeichnung: 'M', bestand: 1 },
        ],
      })
    ),
    ['varianten']
  );
  assert.deepEqual(
    fieldsOf(() => validateInventarArtikel({ ...artikel, varianten: [] })),
    ['varianten']
  );
});

test('a count needs a valid stock for every entry', () => {
  assert.deepEqual(validateInventarZaehlung({ varianten: [{ id: 1, bestand: 5 }] }), {
    varianten: [{ id: 1, bestand: 5 }],
  });
  assert.deepEqual(
    fieldsOf(() => validateInventarZaehlung({ varianten: [{ id: 1, bestand: -2 }] })),
    ['varianten']
  );
  assert.deepEqual(
    fieldsOf(() => validateInventarZaehlung({})),
    ['varianten']
  );
});
