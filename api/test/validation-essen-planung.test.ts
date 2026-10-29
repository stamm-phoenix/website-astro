import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAnlegen,
  validateBeitritt,
  validateEinladung,
  validateEmail,
  validateMitgliedName,
} from '../lib/essen-planung-model';
import { fields } from './fixtures/essen-fields';

const ANLEGEN = {
  email: 'jemand@example.org',
  name: 'Jule',
  planungName: 'Sommerlager 2027',
  ersterTag: '2027-07-24',
  letzterTag: '2027-08-07',
};

const MAIL_FEHLT = 'Bitte eine Mailadresse eintragen.';
const MAIL_UNGUELTIG = 'Bitte eine gültige Mailadresse eintragen, z. B. name@beispiel.de.';

function anlegen(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...ANLEGEN, ...patch };
}

test('Anlegen: a valid body is normalized', () => {
  assert.deepEqual(validateAnlegen(ANLEGEN), ANLEGEN);
  assert.deepEqual(
    validateAnlegen(
      anlegen({
        email: '  Jemand@Example.ORG ',
        name: '  Jule   von  Phoenix ',
        planungName: ' Sommer   lager ',
        ersterTag: '2027-02-28',
        letzterTag: '2027-02-28',
      })
    ),
    {
      email: 'jemand@example.org',
      name: 'Jule von Phoenix',
      planungName: 'Sommer lager',
      ersterTag: '2027-02-28',
      letzterTag: '2027-02-28',
    }
  );
  assert.equal(validateAnlegen(anlegen({ name: 'x'.repeat(100) })).name.length, 100);
  assert.equal(validateAnlegen(anlegen({ planungName: 'x'.repeat(150) })).planungName.length, 150);
});

test('Anlegen: a body that is no object reports every field', () => {
  const expected = {
    email: MAIL_FEHLT,
    name: 'Bitte deinen Namen eintragen.',
    planungName: 'Bitte einen Namen für die Planung eintragen, z. B. „Sommerlager 2027“.',
    ersterTag: 'Bitte den ersten Tag wählen.',
    letzterTag: 'Bitte den letzten Tag wählen.',
  };
  for (const input of [undefined, null, 'text', 7, ['a']]) {
    assert.deepEqual(
      fields(() => validateAnlegen(input)),
      expected
    );
  }
  assert.deepEqual(
    fields(() => validateAnlegen({})),
    expected
  );
});

test('Anlegen: email rules', () => {
  assert.equal(fields(() => validateAnlegen(anlegen({ email: '' }))).email, MAIL_FEHLT);
  assert.equal(fields(() => validateAnlegen(anlegen({ email: '   ' }))).email, MAIL_FEHLT);
  assert.equal(fields(() => validateAnlegen(anlegen({ email: 7 }))).email, MAIL_FEHLT);
  assert.equal(fields(() => validateAnlegen(anlegen({ email: null }))).email, MAIL_FEHLT);
  for (const email of ['kein-at', 'a@b', 'a b@example.org', 'a@@example.org', '@example.org']) {
    assert.equal(fields(() => validateAnlegen(anlegen({ email }))).email, MAIL_UNGUELTIG, email);
  }
  const lang = `${'a'.repeat(250)}@example.org`;
  assert.equal(fields(() => validateAnlegen(anlegen({ email: lang }))).email, MAIL_UNGUELTIG);
  const grenze = `${'a'.repeat(242)}@example.org`;
  assert.equal(grenze.length, 254);
  assert.equal(validateAnlegen(anlegen({ email: grenze })).email, grenze);
});

test('Anlegen: name rules', () => {
  const nameFehlt = 'Bitte deinen Namen eintragen.';
  for (const name of ['', '  ', 7, null, {}]) {
    assert.equal(fields(() => validateAnlegen(anlegen({ name }))).name, nameFehlt);
  }
  assert.equal(
    fields(() => validateAnlegen(anlegen({ name: 'x'.repeat(101) }))).name,
    'Höchstens 100 Zeichen.'
  );
  assert.equal(
    fields(() => validateAnlegen(anlegen({ planungName: 'x'.repeat(151) }))).planungName,
    'Höchstens 150 Zeichen.'
  );
  assert.equal(
    fields(() => validateAnlegen(anlegen({ planungName: ' ' }))).planungName,
    'Bitte einen Namen für die Planung eintragen, z. B. „Sommerlager 2027“.'
  );
});

test('Anlegen: date rules', () => {
  const erster = 'Bitte den ersten Tag wählen.';
  const letzter = 'Bitte den letzten Tag wählen.';
  for (const tag of ['', '2027-02-30', '2027-13-01', '27-07-24', '2027-7-24', 20270724, null]) {
    assert.equal(fields(() => validateAnlegen(anlegen({ ersterTag: tag }))).ersterTag, erster);
    assert.equal(fields(() => validateAnlegen(anlegen({ letzterTag: tag }))).letzterTag, letzter);
  }
  assert.equal(
    fields(() => validateAnlegen(anlegen({ ersterTag: '2027-02-29' }))).ersterTag,
    erster
  );
  assert.equal(
    validateAnlegen(anlegen({ ersterTag: '2028-02-29', letzterTag: '2028-02-29' })).ersterTag,
    '2028-02-29'
  );
  assert.deepEqual(
    fields(() => validateAnlegen(anlegen({ ersterTag: '2027-08-08', letzterTag: '2027-08-07' }))),
    { letzterTag: 'Der letzte Tag liegt vor dem ersten.' }
  );
  assert.equal(
    validateAnlegen(anlegen({ ersterTag: '2027-01-01', letzterTag: '2027-03-01' })).letzterTag,
    '2027-03-01'
  );
  assert.deepEqual(
    fields(() => validateAnlegen(anlegen({ ersterTag: '2027-01-01', letzterTag: '2027-03-02' }))),
    { letzterTag: 'Höchstens 60 Tage.' }
  );
  // No range message while one of the dates is invalid, and the other fields report meanwhile
  assert.deepEqual(
    fields(() => validateAnlegen(anlegen({ ersterTag: 'x', letzterTag: '2027-01-01', name: '' }))),
    { name: 'Bitte deinen Namen eintragen.', ersterTag: erster }
  );
});

test('Mitglied name', () => {
  assert.equal(validateMitgliedName({ name: '  Jule  Pfad ' }), 'Jule Pfad');
  assert.equal(validateMitgliedName({ name: 'x'.repeat(100) }).length, 100);
  for (const input of [{}, { name: ' ' }, { name: 3 }, null, 'x', undefined, [{ name: 'a' }]]) {
    assert.deepEqual(
      fields(() => validateMitgliedName(input)),
      {
        name: 'Bitte einen Namen eintragen.',
      }
    );
  }
  assert.deepEqual(
    fields(() => validateMitgliedName({ name: 'x'.repeat(101) })),
    {
      name: 'Höchstens 100 Zeichen.',
    }
  );
});

test('Beitritt: name and optional email', () => {
  assert.deepEqual(validateBeitritt({ name: ' Jule ' }), { name: 'Jule', email: null });
  assert.deepEqual(validateBeitritt({ name: 'Jule', email: '' }), { name: 'Jule', email: null });
  assert.deepEqual(validateBeitritt({ name: 'Jule', email: 5 }), { name: 'Jule', email: null });
  assert.deepEqual(validateBeitritt({ name: 'Jule', email: ' A@B.de ' }), {
    name: 'Jule',
    email: 'a@b.de',
  });
  assert.deepEqual(
    fields(() => validateBeitritt(null)),
    {
      name: 'Bitte deinen Namen eintragen.',
    }
  );
  assert.deepEqual(
    fields(() => validateBeitritt({ name: 'Jule', email: 'nope' })),
    {
      email: MAIL_UNGUELTIG,
    }
  );
  assert.deepEqual(
    fields(() => validateBeitritt({ name: '', email: 'a@b' })),
    {
      name: 'Bitte deinen Namen eintragen.',
      email: MAIL_UNGUELTIG,
    }
  );
});

test('Einladung: name, email and role', () => {
  const eingeladen = { name: 'Jule', email: 'jule@example.org' };
  assert.deepEqual(validateEinladung({ ...eingeladen, rolle: 'besitzer' }), {
    ...eingeladen,
    rolle: 'besitzer',
  });
  for (const rolle of ['bearbeiten', 'lesen', '', 3, null, undefined]) {
    assert.equal(validateEinladung({ ...eingeladen, rolle }).rolle, 'bearbeiten');
  }
  assert.deepEqual(validateEinladung({ name: ' J  K ', email: ' J@Example.ORG ' }), {
    name: 'J K',
    email: 'j@example.org',
    rolle: 'bearbeiten',
  });
  assert.deepEqual(
    fields(() => validateEinladung('x')),
    {
      name: 'Bitte einen Namen eintragen.',
      email: MAIL_FEHLT,
    }
  );
  assert.deepEqual(
    fields(() => validateEinladung({ name: 'x'.repeat(101), email: 'a b' })),
    {
      name: 'Höchstens 100 Zeichen.',
      email: MAIL_UNGUELTIG,
    }
  );
});

test('Email: lower-cased and required', () => {
  assert.equal(validateEmail({ email: ' Jule@Example.ORG ' }), 'jule@example.org');
  for (const input of [{}, { email: '' }, null, 'x', { email: 7 }]) {
    assert.deepEqual(
      fields(() => validateEmail(input)),
      { email: MAIL_FEHLT }
    );
  }
  assert.deepEqual(
    fields(() => validateEmail({ email: 'a@b' })),
    { email: MAIL_UNGUELTIG }
  );
  assert.deepEqual(
    fields(() => validateEmail({ email: 'a@example.o' })),
    {
      email: MAIL_UNGUELTIG,
    }
  );
});
