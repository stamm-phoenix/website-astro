import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anzahl, paareIn, personenIn, type NamiAbgleichData } from '../src/lib/namiAbgleich';
import type { AbgleichPaar, AbgleichPerson } from '../src/lib/namiAbgleich';

function person(id: string, vorname: string, aktiv = true): AbgleichPerson {
  return {
    id,
    vorname,
    nachname: 'Muster',
    geburtsdatum: null,
    mitgliedsnummer: id,
    aktiv,
    gruppen: [],
  };
}

function paar(name: string, gleich: boolean, extra: Partial<AbgleichPaar> = {}): AbgleichPaar {
  return {
    nami: person(`n-${name}`, name),
    campflow: person(`c-${name}`, name),
    verbindung: 'mitgliedsnummer',
    felder: [{ feld: 'ort', label: 'Ort', nami: 'A', campflow: gleich ? 'A' : 'B', gleich }],
    ...extra,
  };
}

const DATA: NamiAbgleichData = {
  namiLoadedAt: '2026-11-05T10:00:00Z',
  campflowLoadedAt: '2026-11-05T10:00:00Z',
  paare: [
    paar('Anna', false),
    paar('Ben', true),
    paar('Carl', true, { verbindung: 'name' }),
    paar('Dora', false, {
      nami: person('n-Dora', 'Dora', false),
      campflow: person('c-Dora', 'Dora', false),
    }),
  ],
  nurNami: [person('n-Emil', 'Emil'), person('n-Fritz', 'Fritz', false)],
  nurCampflow: [person('c-Gina', 'Gina')],
};

const OHNE = { suche: '', ausgetretene: false };

test('pairs with differences or found by a weak key are to check, the others agree', () => {
  assert.deepEqual(
    paareIn(DATA, 'unterschiede', OHNE).map((p) => p.nami.vorname),
    ['Anna', 'Carl']
  );
  assert.deepEqual(
    paareIn(DATA, 'gleich', OHNE).map((p) => p.nami.vorname),
    ['Ben']
  );
});

test('people who left everywhere are hidden until asked for', () => {
  assert.equal(anzahl(DATA, 'nur-nami', OHNE), 1);
  const mit = { suche: '', ausgetretene: true };
  assert.equal(anzahl(DATA, 'nur-nami', mit), 2);
  assert.deepEqual(
    paareIn(DATA, 'unterschiede', mit).map((p) => p.nami.vorname),
    ['Anna', 'Carl', 'Dora']
  );
});

test('the search finds names in either list and Mitgliedsnummern', () => {
  assert.deepEqual(
    personenIn(DATA, 'nur-campflow', { suche: 'gína', ausgetretene: false }).length,
    1
  );
  assert.deepEqual(
    paareIn(DATA, 'unterschiede', { suche: 'c-carl', ausgetretene: false }).length,
    1
  );
  assert.equal(anzahl(DATA, 'gleich', { suche: 'xyz', ausgetretene: false }), 0);
});

test('a pair with fields not loaded is to check, not agreeing', () => {
  const offen = paar('Hans', true, {
    felder: [{ feld: 'ort', label: 'Ort', nami: '', campflow: 'B', gleich: null }],
  });
  const data = { ...DATA, paare: [offen] };
  assert.equal(paareIn(data, 'unterschiede', OHNE).length, 1);
  assert.equal(paareIn(data, 'gleich', OHNE).length, 0);
});
