import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POSTFAECHER, postfachRoles } from '../../api/lib/postfach-liste';
import {
  POSTFACH_MODULE,
  postfachAusAdresse,
  postfachHref,
  postfachKurzname,
} from '../src/lib/postfaecher';

test('one module for all mailboxes, open to the teams of any of them', () => {
  for (const postfach of POSTFAECHER) {
    for (const role of postfachRoles(postfach)) assert.ok(POSTFACH_MODULE.roles?.includes(role));
  }
  assert.equal(new Set(POSTFACH_MODULE.roles).size, POSTFACH_MODULE.roles?.length);
});

test('the chosen mailbox comes from the address, otherwise the Kontakt-Postfach', () => {
  assert.equal(
    postfachAusAdresse(new URL(postfachHref('vorstand'), 'https://x').search),
    'vorstand'
  );
  assert.equal(postfachAusAdresse(''), 'kontakt');
  assert.equal(postfachAusAdresse('?postfach=unbekannt'), 'kontakt');
});

test('the choice names a mailbox without „-Postfach“', () => {
  assert.equal(postfachKurzname(POSTFAECHER[0]), 'Kontakt');
  for (const postfach of POSTFAECHER) assert.ok(!postfachKurzname(postfach).includes('Postfach'));
});
