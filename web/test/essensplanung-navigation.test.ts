import assert from 'node:assert/strict';
import test from 'node:test';
import { gerichtAusHash, planungHash, tokenAusHash } from '../src/lib/essensplanung.ts';
import {
  eintragVon,
  fremdeTeile,
  indexVon,
  oeffnenderSchritt,
  VERLAUF,
  type Eintrag,
} from '../src/components/essensplanung/planVerlauf.ts';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ01234-_';

test('the address of a dish keeps the token and names the dish', () => {
  const hash = planungHash(TOKEN, 12);
  assert.equal(gerichtAusHash(hash), 12);
  assert.equal(tokenAusHash(hash, 't'), TOKEN);
  assert.equal(planungHash(TOKEN), `#t=${TOKEN}`);
  assert.equal(gerichtAusHash(planungHash(TOKEN)), null);
});

test('only a plain positive number is a dish', () => {
  for (const g of ['0', '01', 'abc', '-3', '1.5', '12345678901', ''])
    assert.equal(gerichtAusHash(`#t=${TOKEN}&g=${g}`), null, g);
  assert.equal(gerichtAusHash(`#t=${TOKEN}&g=1234567890`), 1234567890);
  assert.equal(gerichtAusHash('#main'), null);
});

function eintrag(teil: Partial<Eintrag>, index: unknown, mehr: object = {}): unknown {
  const voll: Eintrag = { bereich: 'gerichte', gericht: 5, von: 'plan', schritt: 3, ...teil };
  return { ...mehr, index, scrollX: 0, scrollY: 0, [VERLAUF]: voll };
}

test('„Zurück“ steps back only from the entry that opened the dish', () => {
  assert.equal(oeffnenderSchritt(eintrag({}, 3), 5), true);
  // A copy in a later entry, e.g. a trip opened meanwhile, has another index
  assert.equal(oeffnenderSchritt(eintrag({}, 4, { essensplanungEinkauf: 7 }), 5), false);
  // Another dish, a dish opened by the address, an entry without the router's index
  assert.equal(oeffnenderSchritt(eintrag({}, 3), 6), false);
  assert.equal(oeffnenderSchritt(eintrag({ von: null }, 3), 5), false);
  assert.equal(oeffnenderSchritt(eintrag({ schritt: null }, undefined), 5), false);
  assert.equal(oeffnenderSchritt(null, 5), false);
  assert.equal(oeffnenderSchritt(eintrag({}, 3), null), false);
});

test('entries without the navigation part read as none', () => {
  assert.equal(eintragVon(null), null);
  assert.equal(eintragVon({ index: 2 }), null);
  assert.equal(eintragVon({ [VERLAUF]: 'kaputt' }), null);
  assert.equal(indexVon({ index: 2 }), 2);
  assert.equal(indexVon({ index: Number('x') }), null);
  assert.equal(indexVon({}), null);
});

test("a new entry takes what others put there, not the router's keys or the old part", () => {
  assert.deepEqual(fremdeTeile(eintrag({}, 3, { essensplanungEinkauf: 7 })), {
    essensplanungEinkauf: 7,
  });
  assert.deepEqual(fremdeTeile(null), {});
});
