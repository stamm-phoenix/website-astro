import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateBookingTags,
  validateHelper,
  validateStufenDecision,
} from '../lib/validation/nikolaus-helfende';
import { ValidationError } from '../lib/validation/errors';

function fields(action: () => unknown): Record<string, string> {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const DATES = ['2026-12-05', '2026-12-06'];
const helper = (patch: Record<string, unknown> = {}) => ({ name: 'Max', ...patch });
const read = (patch: Record<string, unknown> = {}) => validateHelper(helper(patch), DATES);
const readFields = (patch: Record<string, unknown>) =>
  fields(() => validateHelper(helper(patch), DATES));

test('booking tags are cleaned, deduplicated regardless of case and default to none', () => {
  assert.deepEqual(validateBookingTags({ tags: [' Hund ', 'hund', 'Kat,ze', 'Zwei  Wörter'] }), [
    'Hund',
    'Kat ze',
    'Zwei Wörter',
  ]);
  assert.deepEqual(validateBookingTags({}), []);
  assert.deepEqual(validateBookingTags({ tags: null }), []);
  assert.deepEqual(validateBookingTags(null), []);
  assert.deepEqual(validateBookingTags({ tags: [] }), []);
  assert.equal(
    validateBookingTags({ tags: Array.from({ length: 10 }, (_, i) => `M${i}`) }).length,
    10
  );
  assert.equal(validateBookingTags({ tags: ['x'.repeat(40)] }).length, 1);
});

test('booking tags name the field and explain the correction', () => {
  const label = 'Merkmale für die Einteilung';
  assert.deepEqual(
    fields(() => validateBookingTags({ tags: 'Hund' })),
    {
      tags: `Die Angaben unter „${label}“ sind ungültig. Entferne sie und gib die Merkmale erneut ein.`,
    }
  );
  assert.equal(
    fields(() => validateBookingTags({ tags: ['a', 1] })).tags,
    `Die Angaben unter „${label}“ sind ungültig. Entferne sie und gib die Merkmale erneut ein.`
  );
  assert.deepEqual(
    fields(() => validateBookingTags({ tags: Array.from({ length: 11 }, (_, i) => `M${i}`) })),
    {
      tags: `Unter „${label}“ sind höchstens 10 Merkmale möglich. Entferne die übrigen Merkmale.`,
    }
  );
  assert.deepEqual(
    fields(() => validateBookingTags({ tags: ['x'.repeat(41)] })),
    {
      tags: `Ein Merkmal unter „${label}“ ist zu lang. Kürze es auf höchstens 40 Zeichen.`,
    }
  );
});

test('a helper is read with cleaned text, ordered posts and only the configured days', () => {
  assert.deepEqual(
    read({
      name: '  Max   Muster ',
      notes: ' Kommt  später ',
      availability: {
        '2026-12-05': ['Küche', 'Nikolaus', 'Nikolaus'],
        '2026-12-06': [],
        '2026-12-24': ['Engerl'],
      },
      positiveTags: ['Hund'],
      negativeTags: ['Katze'],
    }),
    {
      name: 'Max Muster',
      availability: { '2026-12-05': ['Nikolaus', 'Küche'] },
      positiveTags: ['Hund'],
      negativeTags: ['Katze'],
      notes: 'Kommt später',
    }
  );
  assert.deepEqual(read(), {
    name: 'Max',
    availability: {},
    positiveTags: [],
    negativeTags: [],
    notes: '',
  });
  assert.deepEqual(validateHelper({ name: 'Max', availability: 'x' }, DATES).availability, {});
});

test('a helper reports every invalid field with its message', () => {
  assert.deepEqual(
    fields(() => validateHelper(null, DATES)),
    { name: 'Bitte den Namen angeben.' }
  );
  assert.deepEqual(readFields({ name: 5 }), { name: 'den Namen ist ungültig.' });
  assert.deepEqual(readFields({ name: 'x'.repeat(101) }), {
    name: 'den Namen darf höchstens 100 Zeichen lang sein.',
  });
  assert.deepEqual(readFields({ notes: 'x'.repeat(501) }), {
    notes: 'Bemerkungen darf höchstens 500 Zeichen lang sein.',
  });
  assert.deepEqual(readFields({ notes: 3 }), { notes: 'Bemerkungen ist ungültig.' });
  for (const roles of ['Nikolaus', ['Koch'], [1]]) {
    assert.deepEqual(readFields({ availability: { '2026-12-05': roles } }), {
      availability: 'Die Posten sind ungültig.',
    });
  }
  assert.equal(read({ availability: { '2026-12-24': ['Koch'] } }).notes, '');
  assert.deepEqual(
    readFields({ positiveTags: 'x', negativeTags: Array.from({ length: 11 }, (_, i) => `M${i}`) }),
    {
      positiveTags:
        'Die Angaben unter „Bevorzugt zu Familien mit“ sind ungültig. Entferne sie und gib die Merkmale erneut ein.',
      negativeTags:
        'Unter „Nicht zu Familien mit“ sind höchstens 10 Merkmale möglich. Entferne die übrigen Merkmale.',
    }
  );
  assert.deepEqual(
    readFields({
      name: '',
      positiveTags: [' Wölflinge '],
      negativeTags: ['wölflinge'],
    }),
    {
      name: 'Bitte den Namen angeben.',
      negativeTags:
        'Derselbe Begriff steht in „Bevorzugt zu Familien mit“ und „Nicht zu Familien mit“. Entferne ihn aus einem der beiden Felder.',
    }
  );
});

test('a decision about a suggestion needs a kind, a Stufe, an answer and a numeric target', () => {
  const body = { kind: 'helper', targetId: '12', stufe: 'Rover', decision: 'reject', x: 1 };
  assert.deepEqual(validateStufenDecision(body), {
    kind: 'helper',
    targetId: '12',
    stufe: 'Rover',
    decision: 'reject',
  });
  assert.deepEqual(validateStufenDecision({ ...body, kind: 'booking', decision: 'accept' }), {
    kind: 'booking',
    targetId: '12',
    stufe: 'Rover',
    decision: 'accept',
  });
  assert.deepEqual(
    fields(() =>
      validateStufenDecision({ kind: 'x', stufe: 'Leitende', decision: 1, targetId: 5 })
    ),
    {
      kind: 'Bitte eine gültige Auswahl für die Art treffen.',
      stufe: 'Bitte eine gültige Auswahl für die Stufe treffen.',
      decision: 'Bitte eine gültige Auswahl für die Entscheidung treffen.',
      targetId: 'Der Eintrag ist ungültig.',
    }
  );
  assert.deepEqual(
    fields(() => validateStufenDecision({ ...body, targetId: '1a' })),
    { targetId: 'Der Eintrag ist ungültig.' }
  );
  assert.deepEqual(
    fields(() => validateStufenDecision(null)),
    {
      kind: 'Bitte eine gültige Auswahl für die Art treffen.',
      stufe: 'Bitte eine gültige Auswahl für die Stufe treffen.',
      decision: 'Bitte eine gültige Auswahl für die Entscheidung treffen.',
      targetId: 'Der Eintrag ist ungültig.',
    }
  );
});
