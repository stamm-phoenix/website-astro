import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LIST_RELOADED,
  auswahlBody,
  auswahlCount,
  auswahlDirty,
  isEmailAddress,
  pendingProblem,
  personen,
  refreshAuswahl,
  startAuswahl,
  versandProblem,
} from '../src/lib/protokolleView';
import type { ProtokollRecipient, ProtokollVersandPreview } from '../src/lib/protokolleView';
import { ApiError } from '../src/lib/apiError';

const person = (email: string, name = email): ProtokollRecipient => ({
  email,
  name,
  reasons: ['Label Protokollempfang'],
});

const vorschau = (version: string, ...emails: string[]): ProtokollVersandPreview => ({
  version,
  recipients: emails.length,
  list: emails.map((email) => person(email)),
});

test('the selection starts with everyone and counts each address once', () => {
  const auswahl = startAuswahl(vorschau('v1', 'a@x.de', 'b@x.de', 'c@x.de'), false);
  assert.deepEqual([auswahl.excluded, auswahl.extra, auswahl.pending], [[], [], '']);
  assert.equal(auswahlCount(auswahl), 3);
  auswahl.excluded = ['b@x.de'];
  assert.equal(auswahlCount(auswahl), 2);
  // An address typed by hand that is already on the list is not counted twice
  auswahl.extra = ['gast@x.de', 'a@x.de'];
  assert.equal(auswahlCount(auswahl), 3);
  assert.equal(personen(1), '1 Person');
  assert.equal(personen(22), '22 Personen');
});

test('the body of a delivery names the version and what was taken out or added', () => {
  const auswahl = {
    ...startAuswahl(vorschau('v7', 'a@x.de', 'b@x.de'), true),
    excluded: ['a@x.de'],
    extra: ['gast@x.de'],
    pending: 'nicht-fertig',
  };
  assert.deepEqual(auswahlBody(auswahl), {
    version: 'v7',
    retry: true,
    excluded: ['a@x.de'],
    extra: ['gast@x.de'],
  });
});

test('a changed list keeps the selection: gone addresses drop out, listed extras become ticks', () => {
  const vorher = {
    ...startAuswahl(vorschau('v1', 'karl@x.de', 'erika@x.de', 'max@x.de'), false),
    excluded: ['erika@x.de', 'karl@x.de'],
    extra: ['gast@x.de', 'privat@x.de'],
    pending: 'getippt',
  };
  // Karl lost the label in CampFlow, the guest got it
  const neu = vorschau('v2', 'erika@x.de', 'max@x.de', 'gast@x.de');
  const { auswahl, changed } = refreshAuswahl(vorher, neu);
  assert.equal(changed, true);
  assert.equal(auswahl.version, 'v2');
  assert.deepEqual(auswahl.list, neu.list);
  // Karl is off the list, so his tick means nothing any more; Erika stays unticked
  assert.deepEqual(auswahl.excluded, ['erika@x.de']);
  // The guest is on the list now and decided by the tick there; the private address stays added
  assert.deepEqual(auswahl.extra, ['privat@x.de']);
  assert.equal(auswahl.pending, 'getippt');
  assert.equal(auswahl.retry, false);
  assert.equal(auswahlCount(auswahl), 3);
  assert.deepEqual(auswahlBody(auswahl), {
    version: 'v2',
    retry: false,
    excluded: ['erika@x.de'],
    extra: ['privat@x.de'],
  });
  // The same list again is no change, and a user can say so
  assert.equal(
    refreshAuswahl(auswahl, vorschau('v2', 'erika@x.de', 'max@x.de', 'gast@x.de')).changed,
    false
  );
  assert.match(LIST_RELOADED, /Deine Auswahl bleibt erhalten/);
});

test('closing asks only when the selection or the address field holds something', () => {
  const auswahl = startAuswahl(vorschau('v1', 'a@x.de'), false);
  assert.equal(auswahlDirty(null), false);
  assert.equal(auswahlDirty(auswahl), false);
  assert.equal(auswahlDirty({ ...auswahl, excluded: ['a@x.de'] }), true);
  assert.equal(auswahlDirty({ ...auswahl, extra: ['b@x.de'] }), true);
  assert.equal(auswahlDirty({ ...auswahl, pending: '  ' }), false);
  assert.equal(auswahlDirty({ ...auswahl, pending: 'b@' }), true);
});

test('an address typed but not added stops the delivery with a hint', () => {
  const auswahl = startAuswahl(vorschau('v1', 'a@x.de'), false);
  assert.equal(pendingProblem(auswahl), null);
  assert.equal(pendingProblem({ ...auswahl, pending: '   ' }), null);
  assert.match(
    pendingProblem({ ...auswahl, pending: ' gast@x.de ' }) ?? '',
    /„gast@x\.de“ ist noch nicht hinzugefügt/
  );
  assert.match(pendingProblem({ ...auswahl, pending: 'x' }) ?? '', /Es wurde nichts verschickt/);
});

test('a refused check names its reason and says nothing was sent; other errors use the fallback', () => {
  const geprueft = new ApiError(400, 'Die Eingaben sind unvollständig oder ungültig.', {
    code: 'INVALID',
    fields: { form: 'Die Empfänger*innen in CampFlow haben sich geändert.' },
  });
  assert.equal(
    versandProblem(geprueft, 'Unklar.'),
    'Die Empfänger*innen in CampFlow haben sich geändert. Es wurde nichts verschickt.'
  );
  // A server error without a message reads like the fallback and names whom to ask
  const abgelehnt = new ApiError(500, 'Mail abgelehnt', { unexplained: true });
  assert.match(
    versandProblem(abgelehnt, 'Es ist unklar, ob das Protokoll verschickt wurde.'),
    /^Es ist unklar, ob das Protokoll verschickt wurde\./
  );
  assert.equal(versandProblem(new Error('offline'), 'Unklar.'), 'Unklar.');
});

test('an address needs a name, an @ and a domain, and at most 254 characters', () => {
  assert.equal(isEmailAddress('gast@example.test'), true);
  assert.equal(isEmailAddress('gast@example'), false);
  assert.equal(isEmailAddress('gast example@x.de'), false);
  assert.equal(isEmailAddress('@x.de'), false);
  assert.equal(isEmailAddress(`${'a'.repeat(250)}@x.de`), false);
});
