import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../lib/validation/errors';
import { validateAktion } from '../lib/validation/content';

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const STUFEN = ['Wölflinge', 'Jungpfadfinder', 'Rover'];
const FREE = { title: 'Ausflug', stufen: ['Rover'], start: '2026-05-01' };
const EMPTY = { campflowId: null, description: '', title: '', start: '', end: '', link: '' };

test('a free entry is normalised and the end defaults to the start', () => {
  assert.deepEqual(
    validateAktion(
      {
        ...FREE,
        title: '  Großer   Ausflug ',
        stufen: ['Rover', 'Wölflinge', 'Rover'],
        link: ' https://example.org/anmeldung ',
        description: '<p onclick="x()">Hallo</p><script>x()</script>',
        campflowId: '',
      },
      STUFEN
    ),
    {
      campflowId: null,
      stufen: ['Rover', 'Wölflinge'],
      description: '<p>Hallo</p>',
      title: 'Großer Ausflug',
      start: '2026-05-01',
      end: '2026-05-01',
      link: 'https://example.org/anmeldung',
    }
  );
  assert.equal(validateAktion({ ...FREE, end: ' 2026-05-03 ' }, STUFEN).end, '2026-05-03');
  assert.equal(validateAktion({ ...FREE, end: '2026-05-01' }, STUFEN).end, '2026-05-01');
  assert.equal(validateAktion({ ...FREE, campflowId: null }, STUFEN).campflowId, null);
});

test('an entry linked to CampFlow ignores title, dates and link', () => {
  assert.deepEqual(
    validateAktion(
      {
        campflowId: 'evt_abc123',
        stufen: ['Rover'],
        description: '<b>Info</b>',
        title: 5,
        start: 'kaputt',
        end: 'kaputt',
        link: 'http://x',
      },
      STUFEN
    ),
    { ...EMPTY, campflowId: 'evt_abc123', stufen: ['Rover'], description: '<b>Info</b>' }
  );
  assert.deepEqual(validateAktion({ campflowId: 'evt_x', stufen: ['Rover'] }, STUFEN), {
    ...EMPTY,
    campflowId: 'evt_x',
    stufen: ['Rover'],
  });
});

test('a malformed CampFlow ID is reported and the free fields are validated instead', () => {
  for (const campflowId of ['evt_', 'abc', 7, 'evt_a-b', ['evt_a']]) {
    assert.deepEqual(
      fields(() => validateAktion({ stufen: ['Rover'], campflowId }, STUFEN)),
      {
        campflowId: 'Die CampFlow-Aktion ist ungültig.',
        title: 'Bitte einen Titel angeben.',
        start: 'Bitte ein Startdatum angeben.',
      }
    );
  }
});

test('the Stufen are required, checked against the allowed ones and reported', () => {
  assert.deepEqual(
    fields(() => validateAktion(undefined, STUFEN)),
    {
      stufen: 'Die Auswahl der Stufen enthält ungültige Werte.',
      title: 'Bitte einen Titel angeben.',
      start: 'Bitte ein Startdatum angeben.',
    }
  );
  assert.equal(
    fields(() => validateAktion({ ...FREE, stufen: ['Leitende'] }, STUFEN)).stufen,
    'Die Auswahl der Stufen enthält ungültige Werte.'
  );
  assert.equal(
    fields(() => validateAktion({ ...FREE, stufen: 'Rover' }, STUFEN)).stufen,
    'Die Auswahl der Stufen enthält ungültige Werte.'
  );
  assert.equal(
    fields(() => validateAktion({ ...FREE, stufen: [] }, STUFEN)).stufen,
    'Bitte mindestens eine Stufe auswählen.'
  );
  assert.equal(
    fields(() => validateAktion({ campflowId: 'evt_a', stufen: [] }, STUFEN)).stufen,
    'Bitte mindestens eine Stufe auswählen.'
  );
});

test('title, dates and link report the German messages', () => {
  assert.deepEqual(
    fields(() =>
      validateAktion(
        { stufen: ['Rover'], title: 'x'.repeat(256), start: 3, end: 4, link: 5 },
        STUFEN
      )
    ),
    {
      title: 'einen Titel darf höchstens 255 Zeichen lang sein.',
      start: 'ein Startdatum ist ungültig.',
      end: 'das Enddatum ist ungültig.',
      link: 'Der Anmeldelink ist ungültig.',
    }
  );
  assert.equal(
    fields(() => validateAktion({ ...FREE, start: '2026-02-30' }, STUFEN)).start,
    'Bitte ein gültiges Startdatum angeben.'
  );
  assert.equal(
    fields(() => validateAktion({ ...FREE, start: '1.5.2026' }, STUFEN)).start,
    'Bitte ein gültiges Startdatum angeben.'
  );
  assert.equal(
    fields(() => validateAktion({ ...FREE, start: '2026-05-011' }, STUFEN)).start,
    'Bitte ein gültiges Startdatum angeben.'
  );
  assert.equal(
    fields(() => validateAktion({ ...FREE, end: '2026-13-01' }, STUFEN)).end,
    'Bitte ein gültiges Enddatum angeben.'
  );
  assert.equal(
    fields(() => validateAktion({ ...FREE, end: '2026-04-30' }, STUFEN)).end,
    'Das Enddatum darf nicht vor dem Startdatum liegen.'
  );
  assert.equal(
    fields(() => validateAktion({ ...FREE, link: 'http://example.org' }, STUFEN)).link,
    'Der Anmeldelink muss mit https:// beginnen.'
  );
  assert.equal(
    fields(() => validateAktion({ ...FREE, link: 'https://x.de/' + 'a'.repeat(250) }, STUFEN)).link,
    'Der Anmeldelink darf höchstens 255 Zeichen lang sein.'
  );
  assert.equal(
    fields(() => validateAktion({ ...FREE, link: 'ftp://x.de/' + 'a'.repeat(250) }, STUFEN)).link,
    'Der Anmeldelink muss mit https:// beginnen.'
  );
  assert.equal(
    fields(() => validateAktion({ ...FREE, description: 'x'.repeat(5001) }, STUFEN)).description,
    'Die Beschreibung darf höchstens 5000 Zeichen lang sein.'
  );
  assert.equal(
    fields(() =>
      validateAktion(
        { campflowId: 'evt_a', stufen: ['Rover'], description: 'x'.repeat(5001) },
        STUFEN
      )
    ).description,
    'Die Beschreibung darf höchstens 5000 Zeichen lang sein.'
  );
});

test('the end before the start is reported next to the problems of other fields', () => {
  assert.deepEqual(
    fields(() =>
      validateAktion({ ...FREE, title: '', end: '2026-04-30', link: 'http://x' }, STUFEN)
    ),
    {
      title: 'Bitte einen Titel angeben.',
      end: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
      link: 'Der Anmeldelink muss mit https:// beginnen.',
    }
  );
});
