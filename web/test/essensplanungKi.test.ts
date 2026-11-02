import assert from 'node:assert/strict';
import test from 'node:test';
import { mengeFuerZutat, skaliereMenge, vorschlagKey } from '../src/lib/essensplanungKi.ts';

test('a recipe line chosen for an ingredient keeps its unit, or converts pieces into grams', () => {
  const sechs = { menge: '6', einheit: 'stueck' };
  // With a weight per piece: 6 × 80 g, the pieces stay to take instead
  assert.deepEqual(mengeFuerZutat(sechs, 'masse', 80), {
    menge: '480',
    einheit: 'g',
    alternative: sechs,
  });
  // Without one, never 6 g: the pieces stay pieces
  assert.deepEqual(mengeFuerZutat(sechs, 'masse', null), { ...sechs, alternative: null });
  assert.deepEqual(mengeFuerZutat({ menge: '3', einheit: 'Bund' }, 'masse', null), {
    menge: '3',
    einheit: 'Bund',
    alternative: null,
  });
  // Without an amount the unit follows the ingredient
  assert.deepEqual(mengeFuerZutat({ menge: '', einheit: 'stueck' }, 'masse', null), {
    menge: '',
    einheit: 'g',
    alternative: null,
  });
});

test('amounts of the preview are scaled to other people', () => {
  assert.equal(skaliereMenge('1000', 1.5, 'g'), '1500');
  assert.equal(skaliereMenge('3', 0.5, 'stueck'), '1,5');
  assert.equal(skaliereMenge('1,25', 2, 'kg'), '2,5');
  assert.equal(skaliereMenge('', 2, 'g'), '');
  assert.equal(skaliereMenge('viel', 2, 'g'), 'viel');
});

test('a central ingredient that became one of the Planung meanwhile maps to that one', () => {
  const zutaten = [
    { id: 7, zutatId: 42 },
    { id: 8, zutatId: null },
  ];
  // Someone used onions (42) in another dish while the recipe was read
  assert.equal(vorschlagKey({ zutatId: 42 }, zutaten), 'p:7');
  assert.equal(vorschlagKey({ zutatId: 43 }, zutaten), 'z:43');
  assert.equal(vorschlagKey({ planungZutatId: 8 }, zutaten), 'p:8');
  assert.equal(vorschlagKey(null, zutaten), null);
});
