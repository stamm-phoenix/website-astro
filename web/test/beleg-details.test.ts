import assert from 'node:assert/strict';
import { test } from 'node:test';
import { belegDetails, bezahltText } from '../src/lib/belegDetails';

const beleg = {
  art: 'Ausgabe' as const,
  date: '2026-09-30',
  amountCent: 1234,
  kostenstelle: 'Sommerlager',
  kategorie: 'Verpflegungskosten',
  aktion: 'Altes Lager',
  payout: true,
  paidBy: 'Kim Beispiel',
  note: '',
  submittedBy: 'kim@example.test',
  submittedByName: 'Kim Beispiel',
};

test('a receipt shows its filled details in the order of the form', () => {
  assert.deepEqual(belegDetails(beleg), [
    ['Art', 'Ausgabe'],
    ['Datum', '30.09.2026'],
    ['Betrag', '12,34 €'],
    ['Kostenstelle', 'Sommerlager'],
    ['Kategorie', 'Verpflegungskosten'],
    ['Bezahlt', 'Privat ausgelegt von Kim Beispiel'],
    ['Eingereicht von', 'Kim Beispiel'],
  ]);
});

test('older receipts show their Aktion; income asks nothing about payment', () => {
  const alt = belegDetails({ ...beleg, kostenstelle: '', kategorie: '', submittedByName: '' });
  assert.deepEqual(
    alt.find(([label]) => label === 'Aktion'),
    ['Aktion', 'Altes Lager']
  );
  assert.deepEqual(alt.at(-1), ['Eingereicht von', 'kim@example.test']);
  const einnahme = belegDetails({ ...beleg, art: 'Einnahme', payout: false });
  assert.equal(
    einnahme.some(([label]) => label === 'Bezahlt'),
    false
  );
});

test('how it was paid reads like the choice in the form', () => {
  assert.equal(bezahltText({ payout: false, paidBy: '' }), 'Mit Stammeskarte / aus der Kasse');
  assert.equal(bezahltText({ payout: true, paidBy: 'Sparbuch' }), 'Umbuchung aufs Sparbuch');
});
