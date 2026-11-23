import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planFahrt } from '../src/lib/fahrtenPlan';
import type { FahrtPerson } from '../src/lib/fahrtenPlan';
import { withPrioritaet } from '../src/lib/fahrtenPrioritaet';
import { readPrioritaeten, writePrioritaeten } from '../src/lib/fahrtenUrl';
import { fahrtenMailBody, mailFahrer, namensListe } from '../src/lib/fahrtenMail';

const LEITENDE = 'Leitende / Ehemalige / Externe';

function person(id: string, gruppe: string, plaetze = 0): FahrtPerson {
  return { id, name: id, nachname: id, gruppe, plaetze: { hin: plaetze, rueck: plaetze } };
}

function drivers(personen: FahrtPerson[], prioritaeten = {}): string[] {
  return planFahrt(personen, 'hin', undefined, prioritaeten).autos.map((auto) => auto.fahrer.id);
}

const KINDER = ['a', 'b', 'c'].map((id) => person(id, '🟠 Wölfling'));

test('someone who drives only if needed drives last, and only when the others are not enough', () => {
  const personen = [
    person('gross', '🟠 Wölfling', 5),
    person('klein', '🟠 Wölfling', 3),
    ...KINDER,
  ];
  assert.deepEqual(drivers(personen), ['gross']);
  assert.deepEqual(drivers(personen, { gross: 'notfalls' }), ['klein', 'gross']);
  // Three seats are not enough for five, so the reserve car drives as well
  assert.deepEqual(drivers(personen.slice(1), { klein: 'notfalls' }), ['klein']);
});

test('someone who likes to drive goes before larger cars', () => {
  const personen = [person('gross', '🟠 Wölfling', 7), person('gern', '🟠 Wölfling', 5), ...KINDER];
  assert.deepEqual(drivers(personen), ['gross']);
  assert.deepEqual(drivers(personen, { gern: 'zuerst' }), ['gern']);
});

test('Leitende who drive only if needed stay at home when the families have seats', () => {
  const personen = [person('leitung', LEITENDE, 4), person('familie', '🟠 Wölfling', 5), ...KINDER];
  assert.deepEqual(drivers(personen), ['leitung', 'familie']);
  assert.deepEqual(drivers(personen, { leitung: 'notfalls' }), ['familie']);
});

test('priorities survive the link and normal removes the entry', () => {
  const params = new URLSearchParams('id=evt_1');
  const prioritaeten = withPrioritaet(withPrioritaet({}, 'a', 'zuerst'), 'b', 'notfalls');
  writePrioritaeten(params, prioritaeten);
  assert.deepEqual(readPrioritaeten(params), { a: 'zuerst', b: 'notfalls' });

  writePrioritaeten(params, withPrioritaet(prioritaeten, 'a', 'normal'));
  assert.deepEqual(readPrioritaeten(params), { b: 'notfalls' });
  assert.equal(params.toString(), 'id=evt_1&nur-wenn-noetig=b');
});

test('the mail request holds only person ids, and each driver is listed once', () => {
  const personen = [person('fahrer', '🟠 Wölfling', 4), ...KINDER];
  const plans = { hin: planFahrt(personen, 'hin'), rueck: planFahrt(personen, 'rueck') };
  assert.deepEqual(fahrtenMailBody(plans, '  9 Uhr  '), {
    fahrten: {
      hin: [{ fahrer: 'fahrer', mitfahrende: ['a', 'b', 'c'] }],
      rueck: [{ fahrer: 'fahrer', mitfahrende: ['a', 'b', 'c'] }],
    },
    nachricht: '9 Uhr',
  });
  assert.deepEqual(
    mailFahrer(plans).map((f) => [f.person.id, f.fahrten]),
    [['fahrer', ['hin', 'rueck']]]
  );
  assert.equal(namensListe(['A', 'B', 'C']), 'A, B und C');
});
