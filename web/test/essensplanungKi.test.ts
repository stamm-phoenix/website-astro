import assert from 'node:assert/strict';
import test from 'node:test';
import { mengeFuerZutat, skaliereMenge } from '../src/lib/essensplanungKi.ts';

test('a recipe line chosen for an ingredient in g converts pieces or asks for the amount', () => {
  const sechs = { menge: '6', einheit: 'stueck' as const, hinweis: 'reif' };
  // With a weight per piece: 6 × 80 g
  assert.deepEqual(mengeFuerZutat(sechs, 'masse', 80), {
    menge: '480',
    einheit: 'g',
    hinweis: 'reif',
    neuEintragen: false,
  });
  // Without one, never 6 g: the amount is emptied and the recipe's amount kept as a note
  assert.deepEqual(mengeFuerZutat(sechs, 'masse', null), {
    menge: '',
    einheit: 'g',
    hinweis: '6 Stück, reif',
    neuEintragen: true,
  });
  assert.deepEqual(mengeFuerZutat({ menge: '2', einheit: 'g', hinweis: '' }, 'volumen', null), {
    menge: '',
    einheit: 'ml',
    hinweis: '2 g',
    neuEintragen: true,
  });
  // A fitting unit and an empty amount stay as they are
  assert.equal(
    mengeFuerZutat({ menge: '1,5', einheit: 'kg', hinweis: '' }, 'masse', 80).menge,
    '1,5'
  );
  assert.deepEqual(mengeFuerZutat({ menge: '', einheit: 'stueck', hinweis: '' }, 'masse', null), {
    menge: '',
    einheit: 'g',
    hinweis: '',
    neuEintragen: false,
  });
});

test('amounts of the preview are scaled to other people', () => {
  assert.equal(skaliereMenge('1000', 1.5, 'g'), '1500');
  assert.equal(skaliereMenge('3', 0.5, 'stueck'), '1,5');
  assert.equal(skaliereMenge('1,25', 2, 'kg'), '2,5');
  assert.equal(skaliereMenge('', 2, 'g'), '');
  assert.equal(skaliereMenge('viel', 2, 'g'), 'viel');
});
