import assert from 'node:assert/strict';
import test from 'node:test';
import { editorSitzung } from '../lib/leitendenrunde-termin';
import { ValidationError } from '../lib/validation/errors';
import {
  MAX_PLACE_LENGTH,
  TerminExtractionError,
  parseProtokollTermin,
  readConfirmedTermin,
  toTerminSuggestion,
} from '../lib/protokoll-termin';

const SESSION = '2026-10-07';
const DATE_ERROR = 'Bitte ein gültiges Datum angeben.';
const BEFORE_ERROR = 'Der nächste Termin kann nicht vor der Sitzung liegen.';
const TIME_ERROR = 'Bitte die Uhrzeit als HH:MM angeben.';
const PLACE_TYPE_ERROR = 'Bitte den Ort als Text angeben.';
const PLACE_LENGTH_ERROR = `Bitte höchstens ${MAX_PLACE_LENGTH} Zeichen angeben.`;

function faults(
  input: { date?: unknown; time?: unknown; place?: unknown },
  sessionDate = SESSION
): Record<string, string> {
  try {
    readConfirmedTermin(input, sessionDate);
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

test('a confirmed date is trimmed and normalised', () => {
  assert.deepEqual(
    readConfirmedTermin({ date: ' 2026-11-05 ', time: ' 7:30 ', place: ' Pfadi\n heim ' }, SESSION),
    {
      date: '2026-11-05',
      time: '07:30',
      place: 'Pfadi heim',
    }
  );
  assert.deepEqual(readConfirmedTermin({ date: SESSION }, SESSION), {
    date: SESSION,
    time: null,
    place: null,
  });
  assert.deepEqual(readConfirmedTermin({ date: SESSION, time: null, place: null }, SESSION), {
    date: SESSION,
    time: null,
    place: null,
  });
  assert.deepEqual(readConfirmedTermin({ date: SESSION, time: '  ', place: '  ' }, SESSION), {
    date: SESSION,
    time: null,
    place: null,
  });
  assert.equal(readConfirmedTermin({ date: SESSION, time: '23:59' }, SESSION).time, '23:59');
  assert.equal(readConfirmedTermin({ date: SESSION, time: '00:00' }, SESSION).time, '00:00');
  assert.equal(
    readConfirmedTermin({ date: SESSION, place: 'x'.repeat(MAX_PLACE_LENGTH) }, SESSION).place,
    'x'.repeat(MAX_PLACE_LENGTH)
  );
  // Without a session date in the file name any date is fine
  assert.equal(readConfirmedTermin({ date: '1999-01-01' }, '').date, '1999-01-01');
});

test('the date needs to be a real calendar date, not before the session', () => {
  for (const date of [
    undefined,
    null,
    '',
    ' ',
    'morgen',
    '2026-02-30',
    '2026-13-01',
    '5.11.2026',
    20261105,
    {},
  ]) {
    assert.deepEqual(faults({ date }), { date: DATE_ERROR }, String(date));
  }
  assert.deepEqual(faults({ date: '2026-10-06' }), { date: BEFORE_ERROR });
  assert.deepEqual(faults({ date: ' 2026-10-06 ' }), { date: BEFORE_ERROR });
  // An invalid date wins over the session check, which only applies to real dates
  assert.deepEqual(faults({ date: '2026-02-30' }, '2027-01-01'), { date: DATE_ERROR });
});

test('the time needs HH:MM within a day', () => {
  for (const time of [
    '7 Uhr',
    '24:00',
    '12:60',
    '1:5',
    '123:00',
    '12:3',
    '1930',
    'a',
    '07:30:00',
  ]) {
    assert.deepEqual(faults({ date: SESSION, time }), { time: TIME_ERROR }, time);
  }
  for (const time of [1930, 0, false, true, [], {}, ['19:30']]) {
    assert.deepEqual(faults({ date: SESSION, time }), { time: TIME_ERROR }, String(time));
  }
});

test('the place needs text of at most 120 characters', () => {
  for (const place of [123, 0, false, true, [], {}, ['Heim']]) {
    assert.deepEqual(faults({ date: SESSION, place }), { place: PLACE_TYPE_ERROR }, String(place));
  }
  assert.deepEqual(faults({ date: SESSION, place: 'x'.repeat(MAX_PLACE_LENGTH + 1) }), {
    place: PLACE_LENGTH_ERROR,
  });
  // The length counts after trimming and collapsing whitespace
  assert.deepEqual(faults({ date: SESSION, place: `  ${'x'.repeat(MAX_PLACE_LENGTH + 1)}  ` }), {
    place: PLACE_LENGTH_ERROR,
  });
  assert.equal(
    readConfirmedTermin({ date: SESSION, place: `${'x '.repeat(60)}` }, SESSION).place,
    'x '.repeat(59) + 'x'
  );
});

test('every faulty field is reported, one message each', () => {
  assert.deepEqual(faults({ date: 'x', time: 'x', place: 5 }), {
    date: DATE_ERROR,
    time: TIME_ERROR,
    place: PLACE_TYPE_ERROR,
  });
  assert.deepEqual(faults({ date: '2026-10-01', time: 7, place: 'x'.repeat(200) }), {
    date: BEFORE_ERROR,
    time: TIME_ERROR,
    place: PLACE_LENGTH_ERROR,
  });
});

const CONFIRMED = {
  sourceVersion: '"c:{P1},3"',
  extraction: 'gefunden',
  suggestion: { date: '2026-11-04', time: '19:30', place: 'Heim', quote: 'Nächste LR am 4.11.' },
  decision: 'bestaetigt',
  confirmed: { date: '2026-11-05', time: '18:00', place: 'Pfadiheim' },
  decidedBy: 'stavo@example.test',
  decidedAt: '2026-10-09T12:00:00.000Z',
  extractedAt: '2026-10-08T12:00:00.000Z',
};

function read(value: unknown) {
  return parseProtokollTermin(typeof value === 'string' ? value : JSON.stringify(value));
}

test('the stored value is read as written', () => {
  assert.deepEqual(read(CONFIRMED), CONFIRMED);
  assert.deepEqual(read({ ...CONFIRMED, decision: 'abgelehnt' }), {
    ...CONFIRMED,
    decision: 'abgelehnt',
    confirmed: null,
  });
});

test('unreadable stored values yield no suggestion', () => {
  for (const value of [undefined, '', 'nicht json', '{', 'null', '[]', '[1]', '5', '"x"', 'true']) {
    assert.equal(parseProtokollTermin(value), null, String(value));
  }
});

test('an empty stored object falls back field by field', () => {
  assert.deepEqual(read({}), {
    sourceVersion: '',
    extraction: 'fehler',
    suggestion: { date: null, time: null, place: null, quote: null },
    decision: 'offen',
    confirmed: null,
    decidedBy: '',
    decidedAt: '',
    extractedAt: '',
  });
  // Objects of the wrong kind count as empty
  for (const wrong of [null, 'x', 5, true, [], [{ date: '2026-11-04' }]]) {
    const termin = read({ ...CONFIRMED, suggestion: wrong, confirmed: wrong });
    assert.deepEqual(termin?.suggestion, { date: null, time: null, place: null, quote: null });
    assert.equal(termin?.decision, 'offen');
    assert.equal(termin?.confirmed, null);
  }
});

test('single unreadable fields fall back to the safe value', () => {
  const termin = read({
    ...CONFIRMED,
    sourceVersion: 5,
    extraction: 'unbekannt',
    decidedBy: null,
    decidedAt: 'gestern',
    extractedAt: 7,
  });
  assert.equal(termin?.sourceVersion, '');
  assert.equal(termin?.extraction, 'fehler');
  assert.equal(termin?.decidedBy, '');
  assert.equal(termin?.decidedAt, '');
  assert.equal(termin?.extractedAt, '');
  assert.equal(read({ ...CONFIRMED, decidedAt: '2026-10-09' })?.decidedAt, '2026-10-09');
  for (const extraction of ['constructor', '__proto__', 'toString', '', 5, null, ['fehler']]) {
    assert.equal(read({ ...CONFIRMED, extraction })?.extraction, 'fehler', String(extraction));
  }
  for (const decision of ['constructor', 'BESTAETIGT', 5, null, ['offen']]) {
    assert.equal(read({ ...CONFIRMED, decision })?.decision, 'offen', String(decision));
    assert.equal(read({ ...CONFIRMED, decision })?.confirmed, null);
  }
});

test('suggestion fields are read one by one', () => {
  const suggestion = (value: unknown) => read({ ...CONFIRMED, suggestion: value })?.suggestion;
  assert.deepEqual(suggestion({ date: '2026-02-30', time: '25:00', place: 5, quote: ['x'] }), {
    date: null,
    time: null,
    place: null,
    quote: null,
  });
  assert.deepEqual(suggestion({ date: 20261104, time: 1930, place: '  ', quote: '' }), {
    date: null,
    time: null,
    place: null,
    quote: null,
  });
  assert.deepEqual(
    suggestion({ date: '2026-11-04', time: ' 7:05 ', place: ' Pfadi \n heim ', quote: ' a\n b ' }),
    { date: '2026-11-04', time: '07:05', place: 'Pfadi heim', quote: 'a b' }
  );
  assert.equal(suggestion({ place: 'x'.repeat(200) })?.place, 'x'.repeat(MAX_PLACE_LENGTH));
  assert.equal(suggestion({ quote: 'x'.repeat(400) })?.quote, 'x'.repeat(300));
  assert.equal(suggestion({ date: ' 2026-11-04' })?.date, null);
});

test('a confirmation needs a valid date, otherwise the decision is open', () => {
  const confirmed = (value: unknown) => read({ ...CONFIRMED, confirmed: value });
  for (const date of [undefined, null, '', '2026-02-30', ' 2026-11-05', 20261105]) {
    const termin = confirmed({ date, time: '18:00', place: 'Heim' });
    assert.equal(termin?.decision, 'offen', String(date));
    assert.equal(termin?.confirmed, null);
  }
  assert.deepEqual(confirmed({ date: '2026-11-05', time: 'x', place: 7 })?.confirmed, {
    date: '2026-11-05',
    time: null,
    place: null,
  });
  assert.deepEqual(confirmed({ date: '2026-11-05', time: '9:00', place: 'a  b' })?.confirmed, {
    date: '2026-11-05',
    time: '09:00',
    place: 'a b',
  });
  // Without the decision „bestaetigt“ a stored confirmation is dropped
  assert.equal(
    read({ ...CONFIRMED, decision: 'offen', confirmed: { date: '2026-11-05' } })?.confirmed,
    null
  );
});

const CONTEXT = { sessionDate: SESSION, text: 'Die nächste LR ist am 4. November im Pfadiheim.' };
const ANSWER = {
  status: 'gefunden',
  date: '2026-11-04',
  time: '19:30',
  place: 'Pfadiheim',
  quote: 'nächste LR ist am 4. November',
};

test('the answer of the model must be an object', () => {
  for (const raw of [null, undefined, 'x', 5, true, []]) {
    assert.throws(
      () => toTerminSuggestion(raw, CONTEXT),
      (error: unknown) =>
        error instanceof TerminExtractionError && error.message === 'Unexpected answer of the model'
    );
  }
});

test('the status of the model falls back to unclear, not found carries nothing', () => {
  assert.deepEqual(toTerminSuggestion({ ...ANSWER, status: 'nicht gefunden' }, CONTEXT), {
    extraction: 'nicht gefunden',
    suggestion: { date: null, time: null, place: null, quote: null },
  });
  for (const status of [undefined, null, 5, 'maybe', 'constructor', ['gefunden']]) {
    assert.equal(toTerminSuggestion({ ...ANSWER, status }, CONTEXT).extraction, 'unklar');
  }
  assert.equal(toTerminSuggestion({}, CONTEXT).extraction, 'unklar');
  assert.deepEqual(toTerminSuggestion({}, CONTEXT).suggestion, {
    date: null,
    time: null,
    place: null,
    quote: null,
  });
});

test('dates of the model must be after the session and at most a year ahead', () => {
  const date = (value: unknown) => toTerminSuggestion({ ...ANSWER, date: value }, CONTEXT);
  assert.equal(date('2026-11-04').suggestion.date, '2026-11-04');
  assert.equal(date('2027-10-08').suggestion.date, '2027-10-08');
  assert.equal(date('2027-10-09').suggestion.date, null);
  assert.equal(date(SESSION).suggestion.date, null);
  assert.equal(date('2026-10-06').suggestion.date, null);
  assert.equal(date('2026-02-30').suggestion.date, null);
  assert.equal(date(' 2026-11-04').suggestion.date, null);
  assert.equal(date(20261104).suggestion.date, null);
  assert.equal(date('2026-11-04').extraction, 'gefunden');
  // „gefunden“ without a usable date is only unclear
  assert.equal(date(null).extraction, 'unklar');
});

test('time, place and quote of the model are cleaned and the quote is verified', () => {
  const answer = (patch: Record<string, unknown>) =>
    toTerminSuggestion({ ...ANSWER, ...patch }, CONTEXT);
  assert.deepEqual(answer({ time: '7:30', place: ' Pfadi\nheim ' }).suggestion, {
    date: '2026-11-04',
    time: '07:30',
    place: 'Pfadi heim',
    quote: ANSWER.quote,
  });
  assert.equal(answer({ time: '24:00' }).suggestion.time, null);
  assert.equal(answer({ time: 1930 }).suggestion.time, null);
  assert.equal(answer({ place: 5 }).suggestion.place, null);
  assert.equal(answer({ place: 'x'.repeat(200) }).suggestion.place, 'x'.repeat(MAX_PLACE_LENGTH));
  assert.equal(answer({ quote: 'abc' }).suggestion.quote, null);
  assert.equal(
    answer({ quote: 'Die Nächste LR  ist am 4. November' }).suggestion.quote,
    'Die Nächste LR ist am 4. November'
  );
  assert.equal(answer({ quote: 'erfunden und nicht im Text' }).suggestion.quote, null);
  assert.equal(answer({ quote: 5 }).suggestion.quote, null);
  assert.equal(answer({ quote: ' ' }).extraction, 'unklar');
  assert.equal(
    toTerminSuggestion({ ...ANSWER, quote: 'x'.repeat(400) }, { ...CONTEXT, text: 'x'.repeat(400) })
      .suggestion.quote,
    'x'.repeat(300)
  );
});

const NEXT = { datum: '2026-10-14', uhrzeit: '19:00', ort: ' Pfarr\nheim ' };

test('the editor field reads date, time and place one by one', () => {
  const sitzung = (next: unknown) => editorSitzung(5, JSON.stringify({ naechsteSitzung: next }));
  assert.deepEqual(sitzung(NEXT)?.place, 'Pfarr heim');
  for (const wrong of [null, 'x', 5, true, [], undefined, {}, { datum: 20261014 }]) {
    assert.equal(sitzung(wrong), null, JSON.stringify(wrong));
  }
  assert.equal(sitzung({ ...NEXT, datum: ' 2026-10-14' }), null);
  // The time is not trimmed and needs two digits for the hour
  for (const uhrzeit of ['7:00', ' 19:00', '19:00 ', '24:00', '19:60', 1900, null, undefined]) {
    assert.equal(sitzung({ ...NEXT, uhrzeit })?.time, null, String(uhrzeit));
  }
  assert.equal(sitzung({ ...NEXT, uhrzeit: '07:05' })?.time, '07:05');
  for (const ort of [5, null, '', ' \n ', undefined, ['x']]) {
    assert.equal(sitzung({ ...NEXT, ort })?.place, null, String(ort));
  }
  assert.equal(sitzung({ ...NEXT, ort: 'x'.repeat(500) })?.place, 'x'.repeat(500));
  for (const content of [
    'null',
    '[]',
    '5',
    '"x"',
    '{}',
    '{"naechsteSitzung":null}',
    'nicht json',
  ]) {
    assert.equal(editorSitzung(5, content), null, content);
  }
});
