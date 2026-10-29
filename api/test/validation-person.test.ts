import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAktionZuschuss, validateKeineAktion } from '../lib/validation/aktion-art';
import { ValidationError } from '../lib/validation/errors';
import { validatePerson } from '../lib/validation/person';

const PERSON = {
  name: 'Anna Autorin',
  login: 'anna@stamm-phoenix.de',
  gruppe: 'leitende',
  campflowPersonId: 'per_Anna1',
  aktiv: true,
};

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const person = (body: unknown): Record<string, string> => fields(() => validatePerson(body));

test('a person is normalised: single spaces, login in lower case', () => {
  assert.deepEqual(
    validatePerson({
      ...PERSON,
      name: '  Anna   Autorin ',
      login: ' ANNA@Stamm-Phoenix.de ',
      campflowPersonId: ' per_Anna1 ',
      aktiv: false,
      extra: 1,
    }),
    { ...PERSON, aktiv: false }
  );
  assert.deepEqual(
    validatePerson({ name: 'Otto', gruppe: 'altleitende', aktiv: true, campflowPersonId: null }),
    { name: 'Otto', login: '', gruppe: 'altleitende', campflowPersonId: '', aktiv: true }
  );
  assert.equal(validatePerson({ ...PERSON, gruppe: 'weitere', login: '' }).gruppe, 'weitere');
});

test('a person reports the old messages', () => {
  assert.deepEqual(person({ ...PERSON, name: ' ' }), { name: 'Bitte einen Namen angeben.' });
  assert.equal(person({ ...PERSON, name: 3 }).name, 'einen Namen ist ungültig.');
  assert.equal(
    person({ ...PERSON, name: 'x'.repeat(201) }).name,
    'einen Namen darf höchstens 200 Zeichen lang sein.'
  );
  assert.equal(
    person({ ...PERSON, login: `${'a'.repeat(250)}@b.de` }).login,
    'Der Login darf höchstens 254 Zeichen lang sein.'
  );
  assert.equal(person({ ...PERSON, login: 4 }).login, 'Der Login ist ungültig.');
  assert.deepEqual(person({ ...PERSON, gruppe: 'vorstand' }), {
    gruppe: 'Bitte eine gültige Auswahl für die Gruppe treffen.',
  });
  assert.deepEqual(person({ ...PERSON, aktiv: 'ja' }), {
    aktiv: 'Bitte angeben, ob die Person aktiv ist.',
  });
  assert.deepEqual(person({ ...PERSON, aktiv: undefined }), {
    aktiv: 'Bitte angeben, ob die Person aktiv ist.',
  });
});

test('the login is an e-mail address, and leaders need one', () => {
  const login = 'Bitte den Login als E-Mail-Adresse angeben oder leer lassen.';
  for (const value of ['anna', 'anna@phoenix', 'an na@x.de', '@x.de'])
    assert.equal(person({ ...PERSON, login: value }).login, login, value);
  assert.deepEqual(person({ ...PERSON, login: '' }), {
    login: 'Leitende brauchen die E-Mail-Adresse ihres Microsoft-Kontos.',
  });
  // The login rule wins over the leader rule, and neither is needed for the others
  assert.equal(person({ ...PERSON, login: 'anna' }).login, login);
  assert.equal(validatePerson({ ...PERSON, gruppe: 'weitere', login: '' }).login, '');
});

test('the CampFlow ID must look like a person ID', () => {
  const message = 'Bitte eine Person aus der CampFlow-Mitgliederliste wählen.';
  for (const value of ['evt_1', 'per_', 'per_a-b', `per_${'a'.repeat(61)}`, 'p'.repeat(65)])
    assert.equal(person({ ...PERSON, campflowPersonId: value }).campflowPersonId, message, value);
  assert.equal(
    person({ ...PERSON, campflowPersonId: 5 }).campflowPersonId,
    'Die CampFlow-Person ist ungültig.'
  );
  assert.equal(
    validatePerson({ ...PERSON, campflowPersonId: `per_${'a'.repeat(60)}` }).aktiv,
    true
  );
});

test('a body that is no object reports the missing fields', () => {
  for (const body of [null, [], 'text'])
    assert.deepEqual(person(body), {
      name: 'Bitte einen Namen angeben.',
      gruppe: 'Bitte eine gültige Auswahl für die Gruppe treffen.',
      aktiv: 'Bitte angeben, ob die Person aktiv ist.',
    });
});

test('the grant and the no-Aktion choice are booleans', () => {
  assert.equal(validateAktionZuschuss({ zuschussfaehig: true }), true);
  assert.equal(validateAktionZuschuss({ zuschussfaehig: false }), false);
  assert.equal(validateKeineAktion({ keineAktion: true }), true);
  assert.equal(validateKeineAktion({ keineAktion: false }), false);
  for (const body of [null, [], {}, { zuschussfaehig: 'true' }, { zuschussfaehig: 1 }])
    assert.deepEqual(
      fields(() => validateAktionZuschuss(body)),
      { zuschussfaehig: 'Gib an, ob für die Aktion ein KJR-Zuschuss beantragt wird.' }
    );
  for (const body of [null, [], {}, { keineAktion: 'false' }, { keineAktion: 0 }])
    assert.deepEqual(
      fields(() => validateKeineAktion(body)),
      {
        keineAktion:
          'Gib an, ob das Event eine Aktion ist oder nur eine Bestellung oder Anmeldung.',
      }
    );
});
