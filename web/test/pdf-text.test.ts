import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pdfText } from '../src/lib/pdfText';

test('pdfText keeps what the standard fonts print and drops emoji and symbols', () => {
  assert.equal(pdfText('🟠 Wölfling'), 'Wölfling');
  assert.equal(pdfText('🐦‍🔥 Leiter*in'), 'Leiter*in');
  assert.equal(pdfText('„Größe“ – 5 € · ß'), '„Größe“ – 5 € · ß');
  assert.equal(pdfText('Ștefan ✓ ok'), 'Stefan ok');
  assert.equal(pdfText('Zeile 1 ⚠\nZeile 2'), 'Zeile 1\nZeile 2');
});

test('pdfText keeps a gap for tabs and other spaces', () => {
  assert.equal(pdfText('Seile\t5'), 'Seile 5');
  assert.equal(pdfText('5\u202Fkg Mehl\u00A0und\u2009Salz'), '5 kg Mehl und Salz');
  assert.equal(pdfText('A\t\tB\nC'), 'A B\nC');
});
