import assert from 'node:assert/strict';
import test from 'node:test';
import { validateProtokollInhalt } from '../lib/validation/protokoll-inhalt';
import { PERSON, firstPunkt, inhalt, message } from './fixtures/protokoll-inhalt';
import type { Loose } from './fixtures/protokoll-inhalt';

test('Aufgaben of an agenda item', () => {
  const aufgabe = { id: 'a-1', titel: 'Aufgabe', zustaendig: [PERSON], faellig: '2026-11-04' };
  const ok = inhalt();
  ok.punkte[0].aufgaben = [aufgabe];
  assert.deepEqual(validateProtokollInhalt(ok), ok);
  const broken = (change: Loose): string =>
    message((v) => (firstPunkt(v).aufgaben = [{ ...aufgabe, ...change }]));
  assert.equal(broken({ id: 5 }), 'Ein Element des Protokolls hat keine gültige ID.');
  assert.equal(
    broken({ titel: 'x'.repeat(501) }),
    'Der Titel einer Aufgabe darf höchstens 500 Zeichen lang sein.'
  );
  assert.equal(broken({ titel: undefined }), 'Der Titel einer Aufgabe fehlt.');
  assert.equal(broken({ zustaendig: Array(11).fill(PERSON) }), 'Höchstens 10 Zuständige.');
  assert.equal(broken({ zustaendig: 'Anna' }), 'Zuständige fehlt.');
  assert.equal(broken({ faellig: '4.11.2026' }), 'Die Fälligkeit einer Aufgabe ist ungültig.');
  assert.equal(
    message((v) => (firstPunkt(v).aufgaben = [null])),
    'Eine Aufgabe fehlt.'
  );
  assert.equal(
    message(
      (v) =>
        (firstPunkt(v).aufgaben = Array.from({ length: 31 }, (_, i) => ({
          ...aufgabe,
          id: `a-${i}`,
        })))
    ),
    'Höchstens 30 Aufgaben.'
  );
  assert.equal(
    message((v) => delete firstPunkt(v).aufgaben),
    'Aufgaben fehlt.'
  );
});

test('Termine are optional in older minutes and checked otherwise', () => {
  const termin = {
    id: 't-1',
    titel: 'Vortreffen',
    datum: '2026-11-02',
    uhrzeit: '18:00',
    ort: 'Stammesheim',
    zustaendig: [PERSON],
  };
  const legacy = inhalt() as unknown as Loose;
  delete legacy.punkte[0].termine;
  assert.deepEqual(validateProtokollInhalt(legacy).punkte[0].termine, []);
  const broken = (change: Loose): string =>
    message((v) => (firstPunkt(v).termine = [{ ...termin, ...change }]));
  assert.equal(broken({ datum: '2.11.2026' }), 'Das Datum eines Termins ist ungültig.');
  assert.equal(broken({ uhrzeit: '25:00' }), 'Die Uhrzeit eines Termins ist ungültig.');
  assert.equal(broken({ ort: 'a\nb' }), 'Der Ort eines Termins enthält ungültige Zeichen.');
  assert.equal(broken({ titel: 5 }), 'Der Titel eines Termins fehlt.');
  assert.equal(broken({ zustaendig: undefined }), 'Zuständige fehlt.');
  assert.equal(
    message((v) => (firstPunkt(v).termine = [1])),
    'Ein Termin fehlt.'
  );
  assert.equal(
    message(
      (v) =>
        (firstPunkt(v).termine = Array.from({ length: 21 }, (_, i) => ({
          ...termin,
          id: `t-${i}`,
        })))
    ),
    'Höchstens 20 Termine.'
  );
  assert.equal(
    message((v) => (firstPunkt(v).termine = 'x')),
    'Termine fehlt.'
  );
});

test('the Aktion of an agenda item', () => {
  const aktion = { id: 'evt_1', titel: 'Lager', start: '2026-06-12', ende: '' };
  const ok = inhalt();
  ok.punkte[0].aktion = aktion;
  assert.deepEqual(validateProtokollInhalt(ok), ok);
  const missing = inhalt() as unknown as Loose;
  delete missing.punkte[0].aktion;
  assert.equal(validateProtokollInhalt(missing).punkte[0].aktion, null);
  const broken = (change: unknown): string => message((v) => (firstPunkt(v).aktion = change));
  assert.equal(broken('x'), 'Die Aktion fehlt.');
  assert.equal(
    broken({ ...aktion, id: 'evt-1' }),
    'Die Aktion eines Tagesordnungspunkts ist ungültig.'
  );
  assert.equal(broken({ ...aktion, id: 5 }), 'Die Aktion eines Tagesordnungspunkts ist ungültig.');
  assert.equal(
    broken({ ...aktion, titel: 'a\nb' }),
    'Der Name der Aktion enthält ungültige Zeichen.'
  );
  assert.equal(broken({ ...aktion, start: '12.6.' }), 'Der Beginn der Aktion ist ungültig.');
  assert.equal(broken({ ...aktion, ende: 'x' }), 'Das Ende der Aktion ist ungültig.');
});

test('the project and open tasks of an agenda item', () => {
  const projekt = { id: 7, titel: 'Zeltlager' };
  const offen = { id: 9, titel: 'Zelte', zustaendig: [PERSON], faellig: '', erledigt: false };
  const ok = inhalt();
  ok.punkte[0].projekt = projekt;
  ok.punkte[0].offeneAufgaben = [offen];
  assert.deepEqual(validateProtokollInhalt(ok), ok);
  const legacy = inhalt() as unknown as Loose;
  delete legacy.punkte[0].projekt;
  delete legacy.punkte[0].offeneAufgaben;
  const read = validateProtokollInhalt(legacy);
  assert.equal(read.punkte[0].projekt, null);
  assert.deepEqual(read.punkte[0].offeneAufgaben, []);

  const projectBroken = (change: unknown): string =>
    message((v) => (firstPunkt(v).projekt = change));
  assert.equal(projectBroken('x'), 'Das Projekt fehlt.');
  for (const id of [0, -1, 1.5, '7', 1_000_000_000, null]) {
    assert.equal(
      projectBroken({ ...projekt, id }),
      'Das Projekt eines Tagesordnungspunkts ist ungültig.',
      String(id)
    );
  }
  assert.equal(
    projectBroken({ ...projekt, titel: 'a\nb' }),
    'Der Name des Projekts enthält ungültige Zeichen.'
  );

  const openBroken = (change: Loose): string =>
    message((v) => (firstPunkt(v).offeneAufgaben = [{ ...offen, ...change }]));
  assert.equal(openBroken({ id: 0 }), 'Eine offene Aufgabe ist ungültig.');
  assert.equal(openBroken({ erledigt: 'ja' }), 'Der Stand einer offenen Aufgabe ist ungültig.');
  assert.equal(
    openBroken({ titel: 'x'.repeat(501) }),
    'Der Titel einer offenen Aufgabe darf höchstens 500 Zeichen lang sein.'
  );
  assert.equal(openBroken({ zustaendig: Array(21).fill(PERSON) }), 'Höchstens 20 Zuständige.');
  assert.equal(openBroken({ faellig: 'x' }), 'Die Fälligkeit einer offenen Aufgabe ist ungültig.');
  assert.equal(
    message((v) => (firstPunkt(v).offeneAufgaben = [null])),
    'Eine offene Aufgabe fehlt.'
  );
  assert.equal(
    message(
      (v) =>
        (firstPunkt(v).offeneAufgaben = Array.from({ length: 61 }, (_, i) => ({
          ...offen,
          id: i + 1,
        })))
    ),
    'Höchstens 60 offene Aufgaben.'
  );
  assert.equal(
    message((v) => (firstPunkt(v).offeneAufgaben = 'x')),
    'offene Aufgaben fehlt.'
  );
});
