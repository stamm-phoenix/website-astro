import { after, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { EinkaufHaken } from '../../api/lib/essen-einkaeufe-model';

/*
 * The unsaved input of the live mode of a shopping trip (`components/essensplanung/einkaufLive.ts`):
 * kept while the trip shows its list or form, asked about before leaving the page, dropped once
 * the page is really left, and settled after a tick is saved. The question itself is the app's
 * (`lib/unsavedChanges.ts`, which needs the Astro router); here it is replaced by a record of the
 * checks the module registers, and `document` by a plain event target for `astro:before-swap`.
 */

const pruefungen = new Set<() => boolean>();
// `bun:test` has no types in this project; the name keeps the type check from resolving it
const BUN_TEST = 'bun:test';
const { mock } = (await import(BUN_TEST)) as {
  mock: { module(path: string, factory: () => Record<string, unknown>): void };
};
mock.module('../src/lib/unsavedChanges', () => ({
  guardUnsavedChanges(isDirty: () => boolean): () => void {
    pruefungen.add(isDirty);
    return () => pruefungen.delete(isDirty);
  },
}));
const seite = new EventTarget();
const global = globalThis as unknown as { document?: unknown };
const vorher = global.document;
global.document = seite;
// Other test files run in the same process and must not see this `document`
after(() => {
  if (vorher === undefined) delete global.document;
  else global.document = vorher;
});

const live = await import('../src/components/essensplanung/einkaufLive');
const {
  entwuerfe,
  festeEntwuerfe,
  offeneZeile,
  lebendig,
  liveOffen,
  merkeEntwurf,
  vergissEntwurf,
  merkeFest,
  vergissFest,
  entwurfNachAbhaken,
  gespeicherterEtag,
} = live;

/** Whether leaving the page now would ask first. */
const fragt = (): boolean => [...pruefungen].some((istUngespeichert) => istUngespeichert());
/** The page of the Planung is really left (the router swaps in the next page). */
const verlassen = (): void => void seite.dispatchEvent(new Event('astro:before-swap'));

const eingabe = (menge: string, ersatz = '') => ({
  menge,
  einheit: 'g' as const,
  ersatz,
  etag: '"1"',
  konflikt: 'Kim hat das inzwischen abgehakt.',
});

afterEach(() => {
  verlassen();
  lebendig.clear();
  assert.equal(pruefungen.size, 0, 'no question is left behind');
});

describe('unsaved input of the live mode', () => {
  test('leaving asks while input is kept and no more once the last one is gone', () => {
    assert.equal(fragt(), false);
    merkeEntwurf('7:12:g', eingabe('800'));
    assert.equal(fragt(), true);
    // Typed on: still one question, not one per key stroke
    merkeEntwurf('7:12:g', eingabe('900'));
    assert.equal(pruefungen.size, 1);
    assert.equal(entwuerfe.get('7:12:g')?.menge, '900');
    vergissEntwurf('7:12:g');
    assert.equal(fragt(), false);
    assert.equal(pruefungen.size, 0);
  });

  test('the same ingredient in g and in Bund keeps two inputs, each guarding the page', () => {
    merkeEntwurf('7:12:g', eingabe('800'));
    merkeEntwurf('7:12:bund', { ...eingabe('2'), einheit: 'Bund' });
    vergissEntwurf('7:12:g');
    assert.equal(entwuerfe.get('7:12:bund')?.menge, '2');
    assert.equal(fragt(), true);
    vergissEntwurf('7:12:bund');
    assert.equal(fragt(), false);
  });

  test('a fixed amount typed in the list guards the page like a live input', () => {
    merkeFest('7:12', { menge: '1500', einheit: 'g' });
    merkeEntwurf('7:30:', eingabe(''));
    vergissEntwurf('7:30:');
    // The fixed amount is still unsaved
    assert.equal(fragt(), true);
    assert.deepEqual(festeEntwuerfe.get('7:12'), { menge: '1500', einheit: 'g' });
    vergissFest('7:12');
    assert.equal(fragt(), false);
  });

  test('a cancelled leave keeps everything; leaving the page drops it and asks no more', () => {
    merkeEntwurf('7:12:g', eingabe('800', 'Vollkornnudeln'));
    merkeFest('8:12', { menge: '2', einheit: 'kg' });
    offeneZeile.set(7, '12:g');
    // „Weiter bearbeiten“: the router never swaps, nothing happens to the input
    assert.equal(fragt(), true);
    assert.equal(entwuerfe.get('7:12:g')?.ersatz, 'Vollkornnudeln');

    // „Änderungen verwerfen“: the next page is swapped in
    verlassen();
    assert.equal(entwuerfe.size, 0);
    assert.equal(festeEntwuerfe.size, 0);
    assert.equal(offeneZeile.size, 0);
    assert.equal(fragt(), false);
    assert.equal(pruefungen.size, 0);
    // Back on the Planung and away again: nothing is asked, and nothing is dropped twice
    merkeEntwurf('7:12:g', eingabe('700'));
    vergissEntwurf('7:12:g');
    verlassen();
    assert.equal(fragt(), false);
  });

  test('a later input after leaving guards the page again', () => {
    merkeEntwurf('7:12:g', eingabe('800'));
    verlassen();
    merkeEntwurf('7:12:g', eingabe('900'));
    assert.equal(fragt(), true);
    // The router swaps once more: dropped again
    verlassen();
    assert.equal(entwuerfe.size, 0);
  });

  test('a trip counts as shown in the live mode until its last view went', () => {
    const ersteZu = liveOffen(7);
    const zweiteZu = liveOffen(7);
    ersteZu();
    assert.equal(lebendig.has(7), true);
    zweiteZu();
    assert.equal(lebendig.has(7), false);
  });
});

describe('input after a tick is saved', () => {
  const ort = { key: '7:12:g', einkauf: 7, zeile: '12:g', aktiv: true };
  const gesendet = { menge: '800', einheit: 'g' as const, ersatz: '' };
  const keinEtag = (): string | null => assert.fail('the version is read only for kept input');

  test('saved as it was typed, the input goes and leaving asks nothing', () => {
    merkeEntwurf('7:12:g', eingabe('800'));
    offeneZeile.set(7, '12:g');
    entwurfNachAbhaken(ort, gesendet, keinEtag);
    assert.equal(entwuerfe.has('7:12:g'), false);
    assert.equal(fragt(), false);
    // The row is still there and closes itself
    assert.equal(offeneZeile.get(7), '12:g');
  });

  test('a row that is gone (the list is shown) no longer opens when coming back', () => {
    merkeEntwurf('7:12:g', eingabe('800'));
    offeneZeile.set(7, '12:g');
    offeneZeile.set(8, '12:g');
    entwurfNachAbhaken({ ...ort, aktiv: false }, gesendet, keinEtag);
    assert.equal(offeneZeile.has(7), false);
    assert.equal(fragt(), false);
    // Another trip keeps its open row
    assert.equal(offeneZeile.get(8), '12:g');
  });

  test('a row that is gone keeps another open row of its trip', () => {
    offeneZeile.set(7, '30:');
    entwurfNachAbhaken({ ...ort, aktiv: false }, gesendet, keinEtag);
    assert.equal(offeneZeile.get(7), '30:');
  });

  test('typed on while it was saved, the input stays on the version just saved', () => {
    merkeEntwurf('7:12:g', eingabe('900', 'Vollkornnudeln'));
    entwurfNachAbhaken(ort, gesendet, () => '"2"');
    assert.deepEqual(entwuerfe.get('7:12:g'), {
      menge: '900',
      einheit: 'g',
      ersatz: 'Vollkornnudeln',
      etag: '"2"',
      konflikt: null,
    });
    assert.equal(fragt(), true);
  });

  test('only a changed unit or replacement counts as typed on as well', () => {
    merkeEntwurf('7:12:g', { ...eingabe('800'), einheit: 'kg' });
    entwurfNachAbhaken(ort, gesendet, () => null);
    assert.equal(entwuerfe.get('7:12:g')?.einheit, 'kg');
    merkeEntwurf('7:12:g', eingabe('800', 'Vollkornnudeln'));
    entwurfNachAbhaken(ort, gesendet, () => null);
    assert.equal(entwuerfe.get('7:12:g')?.ersatz, 'Vollkornnudeln');
  });
});

describe('version of a tick as saved in a trip', () => {
  const haken = (id: number, planungZutatId: number, einheit: string, etag: string) =>
    ({ id, planungZutatId, einheit, etag }) as EinkaufHaken;
  const einkaeufe = [
    { id: 6, posten: [haken(1, 12, 'g', '"6-12"')] },
    { id: 7, posten: [haken(2, 30, 'g', '"7-30"'), haken(3, 12, 'kg', '"7-12-kg"')] },
    { id: 8, posten: [haken(4, 12, 'Bund', '"8-12-bund"')] },
  ];

  test('the tick of the ingredient in this trip, in a unit of the same base', () => {
    assert.equal(gespeicherterEtag(einkaeufe, 7, 12, 'g'), '"7-12-kg"');
    assert.equal(gespeicherterEtag(einkaeufe, 6, 12, 'kg'), '"6-12"');
  });

  test('no version for another base unit, another trip or a thing not ticked off', () => {
    assert.equal(gespeicherterEtag(einkaeufe, 8, 12, 'g'), null);
    assert.equal(gespeicherterEtag(einkaeufe, 8, 12, 'Bund'), '"8-12-bund"');
    assert.equal(gespeicherterEtag(einkaeufe, 9, 12, 'g'), null);
    assert.equal(gespeicherterEtag(einkaeufe, 7, 99, 'g'), null);
  });
});
