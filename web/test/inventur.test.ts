import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  KEIN_FILTER,
  filterInventar,
  lagerorte,
  letzteZaehlung,
  nameAusLogin,
  variantenText,
} from '../src/lib/inventur';
import type { InventarArtikel } from '../src/lib/inventur';

function artikel(teile: Partial<InventarArtikel> & { id: number }): InventarArtikel {
  return {
    bezeichnung: 'Artikel',
    kategorie: 'lager',
    einheit: 'Stück',
    lagerort: '',
    zustand: 'gut',
    zubehoer: '',
    fehlend: '',
    notizen: '',
    varianten: [{ id: teile.id, bezeichnung: '', bestand: 1, gezaehltAm: null, gezaehltVon: null }],
    bestand: 1,
    etag: '"1"',
    updatedAt: '',
    updatedBy: '',
    ...teile,
  };
}

const pulli = artikel({
  id: 1,
  bezeichnung: 'Stammespulli',
  kategorie: 'kleidung',
  lagerort: 'Heimkeller',
  varianten: [
    {
      id: 11,
      bezeichnung: 'S',
      bestand: 4,
      gezaehltAm: '2026-10-01T10:00:00Z',
      gezaehltVon: 'a@x.de',
    },
    {
      id: 12,
      bezeichnung: 'M',
      bestand: 7,
      gezaehltAm: '2026-10-05T10:00:00Z',
      gezaehltVon: 'b@x.de',
    },
  ],
  bestand: 11,
});
const kohte = artikel({
  id: 2,
  bezeichnung: 'Kohte',
  kategorie: 'zelt',
  lagerort: 'Container',
  zustand: 'reparatur',
  fehlend: '3 Heringe',
});
const kocher = artikel({
  id: 3,
  bezeichnung: 'Gaskocher',
  lagerort: 'Heimkeller',
  zustand: 'defekt',
});
const alle = [pulli, kohte, kocher];

describe('filterInventar', () => {
  const ids = (filter: Partial<typeof KEIN_FILTER>) =>
    filterInventar(alle, { ...KEIN_FILTER, ...filter }).map((a) => a.id);

  test('without a filter every article stays', () => {
    assert.deepEqual(ids({}), [1, 2, 3]);
  });
  test('searches name, variants and missing parts', () => {
    assert.deepEqual(ids({ suche: ' pull ' }), [1]);
    assert.deepEqual(ids({ suche: 'container' }), [2]);
    assert.deepEqual(ids({ suche: 'heringe' }), [2]);
  });
  test('filters by category, place and condition', () => {
    assert.deepEqual(ids({ kategorie: 'zelt' }), [2]);
    assert.deepEqual(ids({ lagerort: 'Heimkeller' }), [1, 3]);
    assert.deepEqual(ids({ zustand: 'defekt' }), [3]);
    assert.deepEqual(ids({ zustand: 'fehlt' }), [2]);
  });
  test('combines the filters', () => {
    assert.deepEqual(ids({ lagerort: 'Heimkeller', zustand: 'defekt' }), [3]);
    assert.deepEqual(ids({ lagerort: 'Container', kategorie: 'kleidung' }), []);
  });
});

test('the storage places are listed once, sorted', () => {
  assert.deepEqual(lagerorte(alle), ['Container', 'Heimkeller']);
});

test('the stock per variant is shown only for named variants', () => {
  assert.equal(variantenText(pulli), 'S 4 · M 7');
  assert.equal(variantenText(kohte), '');
});

test('the newest count wins', () => {
  assert.deepEqual(letzteZaehlung(pulli), { am: '2026-10-05T10:00:00Z', von: 'b@x.de' });
  assert.equal(letzteZaehlung(kohte), null);
});

test('a name is made from the login', () => {
  assert.equal(nameAusLogin('anna.autorin@stamm-phoenix.de'), 'Anna Autorin');
});
