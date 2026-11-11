import assert from 'node:assert/strict';
import test from 'node:test';
import { changesDetails, mayDeleteBeleg, mayEditBeleg, seesAllBelege } from '../lib/beleg-rechte';
import type { BelegInput } from '../lib/validation/beleg';

const person = (login: string, ...teams: string[]) => ({
  identityProvider: 'aad',
  userId: login,
  userDetails: login,
  userRoles: ['authenticated', 'team_leitende', ...teams.map((team) => `team_${team}`)],
});
const kasse = person('kasse@example.test', 'kasse');
const vorstand = person('vorstand@example.test', 'vorstand');
const uploader = person('Kim@Example.test');
const other = person('sam@example.test');

const stored = {
  submittedBy: 'kim@example.test',
  status: 'Eingereicht',
  art: 'Ausgabe',
  shop: 'REWE',
  date: '2026-09-30',
  amountCent: 1234,
  paidBy: 'Kim Beispiel',
  payout: true,
  kostenstelle: 'Sommerlager',
  kategorie: 'Verpflegungskosten',
  note: '',
};
const input: BelegInput = {
  ...stored,
  art: 'Ausgabe',
  aktion: '',
  status: 'Angenommen',
  reviewNote: 'ok',
};

test('Kasse, Vorstand and the uploader change a receipt until it is accepted', () => {
  for (const principal of [kasse, vorstand, uploader]) {
    assert.equal(mayEditBeleg(stored, principal), true, principal.userDetails);
    assert.equal(mayEditBeleg({ ...stored, status: 'Abgelehnt' }, principal), true);
    assert.equal(mayEditBeleg({ ...stored, status: 'Angenommen' }, principal), false);
  }
  assert.equal(mayEditBeleg(stored, other), false);
  assert.equal(mayEditBeleg({ ...stored, submittedBy: '' }, person('')), false);
});

test('only the Kasse deletes an accepted receipt; Kasse and Vorstand see all', () => {
  const accepted = { ...stored, status: 'Angenommen' };
  assert.equal(mayDeleteBeleg(accepted, kasse), true);
  assert.equal(mayDeleteBeleg(accepted, vorstand), false);
  assert.equal(mayDeleteBeleg(accepted, uploader), false);
  assert.equal(mayDeleteBeleg(stored, uploader), true);
  assert.deepEqual([kasse, vorstand, uploader].map(seesAllBelege), [true, true, false]);
});

test('a decision alone changes no details; spaces of older rows do not count', () => {
  assert.equal(changesDetails(stored, input), false);
  assert.equal(changesDetails({ ...stored, shop: ' REWE  ' }, input), false);
  assert.equal(changesDetails(stored, { ...input, amountCent: 1235 }), true);
  assert.equal(changesDetails(stored, { ...input, paidBy: 'Sam' }), true);
  assert.equal(changesDetails(stored, { ...input, payout: false, paidBy: '' }), true);
});
