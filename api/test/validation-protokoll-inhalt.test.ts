import assert from 'node:assert/strict';
import test from 'node:test';
import { validateProtokollInhalt } from '../lib/validation/protokoll-inhalt';
import {
  PERSON,
  firstPunkt,
  inhalt,
  kopf,
  message,
  punkt,
  reject,
} from './fixtures/protokoll-inhalt';
import type { Loose } from './fixtures/protokoll-inhalt';

test('a valid document is returned as typed and unknown fields are dropped', () => {
  const valid = inhalt();
  assert.deepEqual(validateProtokollInhalt(valid), valid);
  const extra = { ...valid, fremd: 1, kopf: { ...valid.kopf, fremd: 2 } };
  assert.deepEqual(validateProtokollInhalt(extra), valid);
});

test('the document as a whole must be an object and not too long', () => {
  for (const value of [null, undefined, [], 'text', 5])
    assert.equal(reject(value), 'Der Inhalt fehlt.');
  assert.equal(
    message((v) => delete v.kopf),
    'Der Kopf fehlt.'
  );
  assert.equal(
    message((v) => (v.kopf = [])),
    'Der Kopf fehlt.'
  );
  assert.equal(
    message((v) => delete v.naechsteSitzung),
    'Die nächste Sitzung fehlt.'
  );
  assert.equal(
    message((v) => (v.punkte = 'x')),
    'Tagesordnungspunkte fehlt.'
  );
  assert.equal(
    message((v) => (firstPunkt(v).text = 'x'.repeat(20_000) + 'y')),
    'Der Text eines Tagesordnungspunkts darf höchstens 20000 Zeichen lang sein.'
  );
  const huge = inhalt();
  huge.punkte = Array.from({ length: 30 }, (_, i) => punkt(`p-${i}`, { text: 'x'.repeat(20_000) }));
  assert.equal(reject(huge), 'Das Protokoll ist zu lang.');
});

test('the head takes people, or one typed name of older minutes', () => {
  assert.equal(
    message((v) => delete kopf(v).sitzungsleitung),
    'Die Sitzungsleitung fehlt.'
  );
  assert.equal(
    message((v) => (kopf(v).sitzungsleitung = Array(6).fill(PERSON))),
    'Höchstens 5 Die Sitzungsleitung.'
  );
  assert.equal(
    message((v) => (kopf(v).protokollant = [PERSON, PERSON])),
    'Höchstens 1 Wer Protokoll führt.'
  );
  assert.equal(
    message((v) => (kopf(v).sitzungsleitung = 'x'.repeat(201))),
    'Die Sitzungsleitung darf höchstens 200 Zeichen lang sein.'
  );
  assert.equal(
    message((v) => (kopf(v).protokollant = 'a\nb')),
    'Wer Protokoll führt enthält ungültige Zeichen.'
  );
  const legacy = inhalt() as unknown as Loose;
  legacy.kopf.sitzungsleitung = 'Vera Vorstand, Volker';
  legacy.kopf.protokollant = '  ';
  const read = validateProtokollInhalt(legacy);
  assert.deepEqual(read.kopf.sitzungsleitung, [{ login: '', name: 'Vera Vorstand, Volker' }]);
  assert.deepEqual(read.kopf.protokollant, []);
});

test('times, dates and people are checked', () => {
  assert.equal(
    message((v) => (kopf(v).beginn = '25:00')),
    'Der Sitzungsbeginn ist ungültig.'
  );
  assert.equal(
    message((v) => (kopf(v).ende = 5)),
    'Das Sitzungsende ist ungültig.'
  );
  assert.equal(
    message((v) => delete kopf(v).beginn),
    'Der Sitzungsbeginn ist ungültig.'
  );
  assert.equal(
    message((v) => ((v.naechsteSitzung as Loose).datum = '2026-02-30')),
    'Das Datum der nächsten Sitzung ist ungültig.'
  );
  assert.equal(
    message((v) => ((v.naechsteSitzung as Loose).uhrzeit = '7:00')),
    'Die Uhrzeit der nächsten Sitzung ist ungültig.'
  );
  assert.equal(
    message((v) => ((v.naechsteSitzung as Loose).ort = 'a\tb\u0001')),
    'Der Ort der nächsten Sitzung enthält ungültige Zeichen.'
  );
  assert.equal(
    message((v) => (kopf(v).sitzungsleitung = [null])),
    'Eine Person fehlt.'
  );
  assert.equal(
    message((v) => (kopf(v).sitzungsleitung = [{ name: 'A' }])),
    'Der Login fehlt.'
  );
  assert.equal(
    message((v) => (kopf(v).sitzungsleitung = [{ login: '', name: 'x'.repeat(201) }])),
    'Der Name darf höchstens 200 Zeichen lang sein.'
  );
  assert.equal(
    message((v) => (kopf(v).sitzungsleitung = [{ login: 'x'.repeat(255), name: 'A' }])),
    'Der Login darf höchstens 254 Zeichen lang sein.'
  );
  assert.equal(
    message((v) => (kopf(v).externe = 5)),
    'Die Externen fehlt.'
  );
  assert.equal(
    message((v) => (kopf(v).externe = 'x'.repeat(2001))),
    'Die Externen darf höchstens 2000 Zeichen lang sein.'
  );
});

test('attendance of the participants', () => {
  assert.equal(
    message((v) => (kopf(v).teilnehmende = 'x')),
    'Teilnehmende fehlt.'
  );
  assert.equal(
    message((v) => (kopf(v).teilnehmende = Array(151).fill({ ...PERSON, status: 'anwesend' }))),
    'Höchstens 150 Teilnehmende.'
  );
  assert.equal(
    message((v) => (kopf(v).teilnehmende = [1])),
    'Eine teilnehmende Person fehlt.'
  );
  assert.equal(
    message((v) => (kopf(v).teilnehmende = [{ ...PERSON, status: 'da' }])),
    'Die Anwesenheit einer Person ist ungültig.'
  );
  assert.equal(
    message((v) => (kopf(v).teilnehmende = [{ ...PERSON, status: 'entschuldigt', name: 5 }])),
    'Der Name fehlt.'
  );
  const read = inhalt();
  read.kopf.teilnehmende = [{ ...PERSON, status: 'entschuldigt' }];
  assert.deepEqual(validateProtokollInhalt(read), read);
});

test('agenda items: limits, ids and nesting', () => {
  assert.equal(
    message((v) => (v.punkte = Array.from({ length: 41 }, (_, i) => punkt(`p-${i}`)))),
    'Höchstens 40 Tagesordnungspunkte.'
  );
  assert.equal(
    message((v) => (v.punkte = [null])),
    'Ein Tagesordnungspunkt fehlt.'
  );
  assert.equal(
    message((v) => delete firstPunkt(v).unterpunkte),
    'Unterpunkte fehlt.'
  );
  assert.equal(
    message(
      (v) => (firstPunkt(v).unterpunkte = Array.from({ length: 21 }, (_, i) => punkt(`s-${i}`)))
    ),
    'Höchstens 20 Unterpunkte.'
  );
  assert.equal(
    message((v) => (firstPunkt(v).unterpunkte[0].unterpunkte = [punkt('p-deep')])),
    'Höchstens 0 Unterpunkte.'
  );
  for (const id of [undefined, 5, '', 'Gross', 'a b', 'x'.repeat(41)]) {
    assert.equal(
      message((v) => (firstPunkt(v).id = id)),
      'Ein Element des Protokolls hat keine gültige ID.',
      String(id)
    );
  }
  assert.equal(
    message((v) => (firstPunkt(v).unterpunkte[0].id = 'p-1')),
    'Ein Element des Protokolls hat keine gültige ID.'
  );
  assert.equal(
    message((v) => (firstPunkt(v).titel = 'x'.repeat(201))),
    'Der Titel eines Tagesordnungspunkts darf höchstens 200 Zeichen lang sein.'
  );
  assert.equal(
    message((v) => (firstPunkt(v).titel = 'a\nb')),
    'Der Titel eines Tagesordnungspunkts enthält ungültige Zeichen.'
  );
  assert.equal(
    message((v) => delete firstPunkt(v).text),
    'Der Text eines Tagesordnungspunkts fehlt.'
  );
  assert.equal(
    message((v) => (firstPunkt(v).text = 'a\u0007b')),
    'Der Text eines Tagesordnungspunkts enthält ungültige Zeichen.'
  );
});

test('ids are unique across items, sub-items, tasks and dates', () => {
  const twice = inhalt();
  twice.punkte[0].aufgaben = [{ id: 'a-1', titel: 'Aufgabe', zustaendig: [], faellig: '' }];
  twice.punkte[0].termine = [
    { id: 'a-1', titel: 'Termin', datum: '', uhrzeit: '', ort: '', zustaendig: [] },
  ];
  assert.equal(reject(twice), 'Ein Element des Protokolls hat keine gültige ID.');
});

test('a list that is too long reports its length before its items', () => {
  assert.equal(
    message((v) => (v.punkte = [null, ...Array.from({ length: 40 }, (_, i) => punkt(`p-${i}`))])),
    'Höchstens 40 Tagesordnungspunkte.'
  );
});
