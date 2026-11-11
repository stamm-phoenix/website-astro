import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pruefHinweise } from '../src/lib/belegPruefHinweise';
import type { BelegCheck } from '../src/lib/types';

const ok: BelegCheck = {
  ok: true,
  isReceipt: true,
  complete: true,
  readable: true,
  unsignedEigenbeleg: false,
  issues: [],
  restrictedItems: [],
  shop: 'REWE',
  date: '2026-09-30',
  amountCent: 999,
  checkedAt: '2026-10-01T12:00:00Z',
};

test('a checked, readable receipt warns about nothing', () => {
  assert.deepEqual(pruefHinweise(ok, []), []);
  assert.deepEqual(pruefHinweise(null, []), []);
});

test('the photo, the check and restricted items each warn once', () => {
  assert.deepEqual(
    pruefHinweise(
      { ...ok, ok: false, issues: ['Unscharf.', 'Unscharf.'], restrictedItems: ['Bier', 'Wein'] },
      ['Das Foto ist sehr dunkel.']
    ),
    ['Das Foto ist sehr dunkel.', 'Unscharf.', 'Diese Positionen prüft die Kasse: Bier, Wein.']
  );
});

test('without its own words the check says what is missing', () => {
  assert.deepEqual(
    pruefHinweise({ ...ok, ok: false, isReceipt: false, complete: false, readable: false }, []),
    [
      'Das Foto zeigt möglicherweise keinen Beleg.',
      'Der Beleg ist nicht vollständig zu sehen.',
      'Der Beleg ist nicht gut lesbar.',
    ]
  );
  assert.equal(pruefHinweise({ ...ok, unsignedEigenbeleg: true }, []).length, 1);
});

test('a small photo is a hint to check it, judged on its finished size', () => {
  assert.deepEqual(pruefHinweise(ok, [], { width: 650, height: 400 }), [
    'Das Foto ist klein (650 Pixel an der längeren Seite). Prüfe, ob Betrag, Datum und Geschäft gut lesbar sind.',
  ]);
  assert.deepEqual(pruefHinweise(ok, [], { width: 600, height: 800 }), []);
  assert.deepEqual(pruefHinweise(ok, [], null), []);
});
