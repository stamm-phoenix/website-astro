import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POSTFAECHER, postfachRoles } from '../../api/lib/postfach-liste';
import {
  POSTFACH_MODULE,
  aktuelleModulPfade,
  aktuelleZaehler,
  aktuellerModulPfad,
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

test('a favorite of a single mailbox becomes the module „Postfächer“', () => {
  assert.equal(aktuellerModulPfad('/leitendenbereich/email/vorstand'), '/leitendenbereich/email');
  assert.equal(aktuellerModulPfad('/leitendenbereich/aufgaben'), '/leitendenbereich/aufgaben');
  assert.equal(aktuellerModulPfad(42), 42);
});

test('recent areas and counts of single mailboxes merge into the module', () => {
  assert.deepEqual(
    aktuelleModulPfade([
      '/leitendenbereich/email/kontakt',
      '/leitendenbereich/aufgaben',
      '/leitendenbereich/email/vorstand',
    ]),
    ['/leitendenbereich/email', '/leitendenbereich/aufgaben']
  );
  assert.deepEqual(
    aktuelleZaehler({
      '/leitendenbereich/email/kontakt': 5,
      '/leitendenbereich/email': 2,
      '/leitendenbereich/belege': 1,
    }),
    { '/leitendenbereich/email': 7, '/leitendenbereich/belege': 1 }
  );
});
