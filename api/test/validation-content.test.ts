import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../lib/validation/errors';
import {
  validateGruppenstunde,
  validateLeitende,
  validateQuestionAndAnswer,
} from '../lib/validation/content';

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const STUFEN = ['Wölflinge', 'Jungpfadfinder'];

// --- Fragen & Antworten ---

const FAQ = { question: 'Was?', answer: '<p>So.</p>', category: 'Lager', published: true };

test('FAQ input is normalised and the answer is sanitized with its links kept', () => {
  assert.deepEqual(
    validateQuestionAndAnswer({
      question: '  Was   nun? ',
      answer: '<p onclick="x()">Hallo <a href="https://a.de" target="_blank">Link</a></p>',
      category: '  Zelte  und  mehr ',
      published: true,
    }),
    {
      question: 'Was nun?',
      answer: '<p>Hallo <a href="https://a.de">Link</a></p>',
      category: 'Zelte und mehr',
      published: true,
    }
  );
  assert.equal(validateQuestionAndAnswer({ ...FAQ, category: undefined }).category, 'Allgemein');
  assert.equal(validateQuestionAndAnswer({ ...FAQ, category: null }).category, 'Allgemein');
});

test('a FAQ draft may have an empty answer, a published question may not', () => {
  const draft = validateQuestionAndAnswer({ ...FAQ, answer: '', published: false });
  assert.deepEqual(draft, { question: 'Was?', answer: '', category: 'Lager', published: false });
  assert.equal(
    fields(() => validateQuestionAndAnswer({ ...FAQ, answer: undefined, published: false })).answer,
    'Bitte eine gültige Antwort angeben.'
  );
  assert.equal(
    validateQuestionAndAnswer({ ...FAQ, answer: '<p>x</p>', published: false }).published,
    false
  );
});

test('FAQ validation reports the German messages per field', () => {
  assert.deepEqual(
    fields(() => validateQuestionAndAnswer({ question: ' ', published: 'ja' })),
    {
      question: 'Bitte eine Frage angeben.',
      published: 'Bitte einen gültigen Veröffentlichungsstatus angeben.',
      answer: 'Bitte eine Antwort angeben.',
    }
  );
  assert.deepEqual(
    fields(() => validateQuestionAndAnswer(null)),
    {
      question: 'Bitte eine Frage angeben.',
      published: 'Bitte einen gültigen Veröffentlichungsstatus angeben.',
      answer: 'Bitte eine Antwort angeben.',
    }
  );
  assert.equal(
    fields(() => validateQuestionAndAnswer({ ...FAQ, question: 5 })).question,
    'eine Frage ist ungültig.'
  );
  assert.equal(
    fields(() => validateQuestionAndAnswer({ ...FAQ, question: 'x'.repeat(256) })).question,
    'eine Frage darf höchstens 255 Zeichen lang sein.'
  );
  assert.equal(
    fields(() => validateQuestionAndAnswer({ ...FAQ, category: 'x'.repeat(101) })).category,
    'das Thema darf höchstens 100 Zeichen lang sein.'
  );
  assert.equal(
    fields(() => validateQuestionAndAnswer({ ...FAQ, answer: '<p><br>&nbsp;</p>' })).answer,
    'Bitte eine Antwort angeben.'
  );
  assert.equal(
    fields(() => validateQuestionAndAnswer({ ...FAQ, answer: 7, published: false })).answer,
    'Bitte eine gültige Antwort angeben.'
  );
  assert.equal(
    fields(() => validateQuestionAndAnswer({ ...FAQ, answer: 7 })).answer,
    'Bitte eine Antwort angeben.'
  );
});

test('a FAQ answer is limited by its visible text and its markup', () => {
  const tooLong = 'Die Antwort ist zu lang. Bitte auf höchstens 5000 Zeichen kürzen.';
  assert.equal(validateQuestionAndAnswer({ ...FAQ, answer: 'x'.repeat(5000) }).answer.length, 5000);
  for (const published of [true, false]) {
    assert.equal(
      fields(() => validateQuestionAndAnswer({ ...FAQ, answer: 'x'.repeat(5001), published }))
        .answer,
      tooLong
    );
  }
  const markup = `<p>${'<b>a</b>'.repeat(8000)}</p>`;
  assert.equal(fields(() => validateQuestionAndAnswer({ ...FAQ, answer: markup })).answer, tooLong);
});

test('a FAQ problem in one field does not hide the problems of the others', () => {
  assert.deepEqual(
    fields(() => validateQuestionAndAnswer({ question: '', answer: '', published: true })),
    { question: 'Bitte eine Frage angeben.', answer: 'Bitte eine Antwort angeben.' }
  );
});

// --- Gruppenstunden ---

const GRUPPE = {
  stufe: 'Wölflinge',
  weekday: 'Montags',
  time: '17:00',
  ageRange: '7–10',
  location: 'Pfarrheim',
  description: '<p onclick="x()">Spiele</p>',
};

test('Gruppenstunden are normalised and their description is sanitized', () => {
  assert.deepEqual(
    validateGruppenstunde(
      { ...GRUPPE, weekday: ' Montags ', time: ' 17:00   Uhr ', ageRange: undefined },
      STUFEN
    ),
    {
      stufe: 'Wölflinge',
      weekday: 'Montags',
      time: '17:00 Uhr',
      ageRange: '',
      location: 'Pfarrheim',
      description: '<p>Spiele</p>',
    }
  );
  assert.equal(validateGruppenstunde({ ...GRUPPE, description: 5 }, STUFEN).description, '');
  assert.equal(
    validateGruppenstunde({ ...GRUPPE, description: undefined }, STUFEN).description,
    ''
  );
  assert.equal(
    validateGruppenstunde({ ...GRUPPE, description: 'x'.repeat(5000) }, STUFEN).description.length,
    5000
  );
});

test('Gruppenstunden report the German messages per field', () => {
  assert.deepEqual(
    fields(() => validateGruppenstunde(undefined, STUFEN)),
    {
      stufe: 'Bitte eine gültige Auswahl für die Stufe treffen.',
      weekday: 'Bitte den Wochentag angeben.',
      time: 'Bitte die Uhrzeit angeben.',
      location: 'Bitte den Ort angeben.',
    }
  );
  assert.equal(
    fields(() => validateGruppenstunde({ ...GRUPPE, stufe: 'Rover' }, STUFEN)).stufe,
    'Bitte eine gültige Auswahl für die Stufe treffen.'
  );
  assert.equal(
    fields(() => validateGruppenstunde({ ...GRUPPE, stufe: 3 }, STUFEN)).stufe,
    'Bitte eine gültige Auswahl für die Stufe treffen.'
  );
  assert.deepEqual(
    fields(() =>
      validateGruppenstunde(
        {
          ...GRUPPE,
          weekday: 'x'.repeat(31),
          time: 'x'.repeat(61),
          ageRange: 'x'.repeat(61),
          location: 'x'.repeat(121),
          description: 'x'.repeat(5001),
        },
        STUFEN
      )
    ),
    {
      weekday: 'den Wochentag darf höchstens 30 Zeichen lang sein.',
      time: 'die Uhrzeit darf höchstens 60 Zeichen lang sein.',
      ageRange: 'das Alter darf höchstens 60 Zeichen lang sein.',
      location: 'den Ort darf höchstens 120 Zeichen lang sein.',
      description: 'Die Beschreibung darf höchstens 5000 Zeichen lang sein.',
    }
  );
  assert.equal(
    fields(() => validateGruppenstunde({ ...GRUPPE, ageRange: [] }, STUFEN)).ageRange,
    'das Alter ist ungültig.'
  );
});

// --- Leitende ---

const TEAMS = ['Vorstand', 'Rover', 'Wölflinge'];
const PERSON = { name: 'Max Muster', teams: ['Rover'] };
const VORSTAND = {
  name: 'Eva Vorstand',
  teams: ['Vorstand', 'Rover'],
  phone: '+49 171 234-56',
  street: ' Hauptstr.  1 ',
  postalCode: '12345',
  city: 'Musterstadt',
};

test('Leitende keep contact details only for the Vorstand', () => {
  assert.deepEqual(validateLeitende(VORSTAND, TEAMS), {
    name: 'Eva Vorstand',
    teams: ['Vorstand', 'Rover'],
    phone: '+49 171 234-56',
    street: 'Hauptstr. 1',
    postalCode: '12345',
    city: 'Musterstadt',
  });
  assert.deepEqual(validateLeitende({ ...VORSTAND, teams: ['Rover', 'Rover'] }, TEAMS), {
    name: 'Eva Vorstand',
    teams: ['Rover'],
    phone: '',
    street: '',
    postalCode: '',
    city: '',
  });
  assert.deepEqual(validateLeitende({ ...PERSON, phone: 'kein Telefon', postalCode: 'x' }, TEAMS), {
    ...PERSON,
    phone: '',
    street: '',
    postalCode: '',
    city: '',
  });
  assert.deepEqual(validateLeitende({ name: 'Eva', teams: ['Vorstand'] }, TEAMS), {
    name: 'Eva',
    teams: ['Vorstand'],
    phone: '',
    street: '',
    postalCode: '',
    city: '',
  });
});

test('Leitende report the German messages per field', () => {
  assert.deepEqual(
    fields(() => validateLeitende(null, TEAMS)),
    {
      name: 'Bitte den Namen angeben.',
      teams: 'Teams enthält ungültige Werte.',
    }
  );
  assert.equal(
    fields(() => validateLeitende({ ...PERSON, teams: ['Rover', 'Gibtsnicht'] }, TEAMS)).teams,
    'Teams enthält ungültige Werte.'
  );
  assert.equal(
    fields(() => validateLeitende({ ...PERSON, teams: 'Rover' }, TEAMS)).teams,
    'Teams enthält ungültige Werte.'
  );
  assert.equal(
    fields(() => validateLeitende({ ...PERSON, name: 'x'.repeat(101) }, TEAMS)).name,
    'den Namen darf höchstens 100 Zeichen lang sein.'
  );
  assert.equal(
    fields(() => validateLeitende({ ...VORSTAND, phone: 'abc' }, TEAMS)).phone,
    'Bitte eine gültige Telefonnummer angeben.'
  );
  assert.equal(
    fields(() => validateLeitende({ ...VORSTAND, postalCode: '1234' }, TEAMS)).postalCode,
    'Bitte eine fünfstellige PLZ angeben.'
  );
  assert.equal(
    fields(() => validateLeitende({ ...VORSTAND, city: '' }, TEAMS)).street,
    'Bitte die Adresse vollständig oder gar nicht angeben.'
  );
  assert.equal(
    validateLeitende({ ...VORSTAND, street: '', postalCode: '', city: '' }, TEAMS).street,
    ''
  );
});

test('Leitende text limits and types report even for people without contact details', () => {
  assert.deepEqual(
    fields(() =>
      validateLeitende(
        {
          ...PERSON,
          phone: 'x'.repeat(41),
          street: 'x'.repeat(121),
          postalCode: 5,
          city: 'x'.repeat(81),
        },
        TEAMS
      )
    ),
    {
      phone: 'Telefon darf höchstens 40 Zeichen lang sein.',
      street: 'Straße darf höchstens 120 Zeichen lang sein.',
      postalCode: 'PLZ ist ungültig.',
      city: 'Ort darf höchstens 80 Zeichen lang sein.',
    }
  );
});

test('Leitende collect the problems of different fields together', () => {
  assert.deepEqual(
    fields(() => validateLeitende({ ...VORSTAND, name: '', phone: 'abc', postalCode: '1' }, TEAMS)),
    {
      name: 'Bitte den Namen angeben.',
      phone: 'Bitte eine gültige Telefonnummer angeben.',
      postalCode: 'Bitte eine fünfstellige PLZ angeben.',
    }
  );
});
