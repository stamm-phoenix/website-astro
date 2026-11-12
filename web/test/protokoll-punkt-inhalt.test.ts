import assert from 'node:assert/strict';
import test from 'node:test';
import { neuerPunkt } from '../../api/lib/protokoll-editor-model.ts';
import { punktHatInhalt } from '../src/lib/protokollPunktInhalt.ts';

test('an item with only a title has no content, so it goes without asking', () => {
  assert.equal(punktHatInhalt(neuerPunkt('p1', 'Sonstiges')), false);
  assert.equal(punktHatInhalt({ ...neuerPunkt('p1'), text: '  \n' }), false);
});

test('text, a date or a sub-item with a title count as content', () => {
  assert.equal(punktHatInhalt({ ...neuerPunkt('p1'), text: 'Besprochen' }), true);
  assert.equal(
    punktHatInhalt({ ...neuerPunkt('p1'), zeitraum: { start: '2026-06-12', ende: '' } }),
    true
  );
  assert.equal(
    punktHatInhalt({ ...neuerPunkt('p1'), unterpunkte: [neuerPunkt('p2', 'Wölflinge')] }),
    true
  );
  assert.equal(punktHatInhalt({ ...neuerPunkt('p1'), unterpunkte: [neuerPunkt('p2')] }), false);
});
