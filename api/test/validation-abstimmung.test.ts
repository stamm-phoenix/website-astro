import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../lib/validation/errors';
import { MAX_ABSTIMMUNG_OPTIONEN } from '../lib/abstimmung-model';
import type { AbstimmungRegeln } from '../lib/abstimmung-model';
import {
  validateAbstimmung,
  validateAbstimmungName,
  validateAntwort,
} from '../lib/abstimmung-schema';

const OPTIONEN = [{ text: 'A' }, { text: 'B' }];

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const form = (extra: Record<string, unknown>) => () =>
  validateAbstimmung({ titel: 'X', optionen: OPTIONEN, ...extra });

test('validateAbstimmung normalises a minimal form and applies the defaults', () => {
  assert.deepEqual(
    validateAbstimmung({
      titel: '  Pizza oder Döner?  ',
      beschreibung: null,
      optionen: [{ text: ' Pizza ' }, { text: '  ' }, null, { text: 'Döner', id: null }, 'x'],
    }),
    {
      titel: 'Pizza oder Döner?',
      beschreibung: '',
      maxAuswahl: null,
      vielleichtErlaubt: false,
      sichtbarkeit: 'offen',
      optionen: [{ text: 'Pizza' }, { text: 'Döner' }],
      bekannteStimmen: {},
    }
  );
  assert.equal(form({ sichtbarkeit: null })().sichtbarkeit, 'offen');
});

test('validateAbstimmung keeps ids, settings and the plausible known votes', () => {
  assert.deepEqual(
    validateAbstimmung({
      titel: 'X',
      beschreibung: '  Details ',
      maxAuswahl: MAX_ABSTIMMUNG_OPTIONEN,
      vielleichtErlaubt: true,
      sichtbarkeit: 'anonym',
      optionen: [{ id: 4, text: 'A' }, { text: 'B' }],
      bekannteStimmen: { 4: 2, 5: 0, x: 1, 1234567890: 1, 6: -1, 7: 1.5, 8: '1' },
    }),
    {
      titel: 'X',
      beschreibung: 'Details',
      maxAuswahl: MAX_ABSTIMMUNG_OPTIONEN,
      vielleichtErlaubt: true,
      sichtbarkeit: 'anonym',
      optionen: [{ id: 4, text: 'A' }, { text: 'B' }],
      bekannteStimmen: { 4: 2, 5: 0 },
    }
  );
  assert.deepEqual(form({ bekannteStimmen: [1, 2] })().bekannteStimmen, {});
  assert.deepEqual(form({ bekannteStimmen: 'viele' })().bekannteStimmen, {});
});

test('validateAbstimmung reports the messages of every rule', () => {
  assert.deepEqual(
    fields(() => validateAbstimmung(null)),
    { form: 'Bitte prüfe die Eingaben.' }
  );
  for (const titel of [undefined, null, 7, '   ']) {
    assert.deepEqual(fields(form({ titel })), { titel: 'Die Frage fehlt.' });
  }
  assert.deepEqual(fields(form({ titel: 'x'.repeat(201) })), {
    titel: 'Die Frage darf höchstens 200 Zeichen haben.',
  });
  assert.equal(form({ titel: 'x'.repeat(200) })().titel.length, 200);
  assert.deepEqual(fields(form({ beschreibung: 5 })), { beschreibung: 'Die Beschreibung fehlt.' });
  assert.deepEqual(fields(form({ beschreibung: 'x'.repeat(2001) })), {
    beschreibung: 'Die Beschreibung darf höchstens 2000 Zeichen haben.',
  });
  for (const maxAuswahl of [0, 1.5, '2', 41, true, NaN]) {
    assert.deepEqual(fields(form({ maxAuswahl })), {
      maxAuswahl: 'Bitte wähle, wie viele Optionen man wählen kann.',
    });
  }
  assert.equal(form({ maxAuswahl: 1 })().maxAuswahl, 1);
  assert.equal(form({ maxAuswahl: null })().maxAuswahl, null);
  for (const vielleichtErlaubt of [null, 'ja', 1]) {
    assert.deepEqual(fields(form({ vielleichtErlaubt })), {
      vielleichtErlaubt: 'Bitte wähle, ob „Vielleicht“ möglich ist.',
    });
  }
  assert.equal(form({ vielleichtErlaubt: false })().vielleichtErlaubt, false);
  for (const sichtbarkeit of ['alle', 5, '']) {
    assert.deepEqual(fields(form({ sichtbarkeit })), {
      sichtbarkeit: 'Bitte wähle, wer die Antworten sieht.',
    });
  }
});

test('validateAbstimmung reports the messages for the options', () => {
  const zwei = 'Bitte trag mindestens zwei Optionen ein.';
  for (const optionen of [undefined, null, 'A', {}, [], [{ text: 'A' }], [{ text: ' ' }, {}]]) {
    assert.deepEqual(fields(form({ optionen })), { optionen: zwei });
  }
  assert.deepEqual(fields(form({ optionen: [{ text: 5 }, OPTIONEN[0]] })), {
    optionen: 'Der Text einer Option fehlt.',
  });
  assert.deepEqual(fields(form({ optionen: [{ text: 'x'.repeat(201) }] })), {
    optionen: 'Der Text einer Option darf höchstens 200 Zeichen haben.',
  });
  assert.deepEqual(fields(form({ optionen: [{ text: 'Pizza' }, { text: ' pizza ' }] })), {
    optionen: 'Die Option „pizza“ steht zweimal in der Liste.',
  });
  // The duplicate comes first, as the rows are read in order
  assert.deepEqual(
    fields(form({ optionen: [{ text: 'A' }, { text: 'a' }, { text: 'B', id: 'x' }] })),
    { optionen: 'Die Option „a“ steht zweimal in der Liste.' }
  );
  const ungueltig = 'Die Liste der Optionen ist ungültig.';
  for (const id of ['1', 0, -3, 1.5, true]) {
    assert.deepEqual(fields(form({ optionen: [{ text: 'A', id }, OPTIONEN[1]] })), {
      optionen: ungueltig,
    });
  }
  assert.deepEqual(
    fields(
      form({
        optionen: [
          { text: 'A', id: 2 },
          { text: 'B', id: 2 },
        ],
      })
    ),
    { optionen: ungueltig }
  );
  const viele = Array.from({ length: MAX_ABSTIMMUNG_OPTIONEN + 1 }, (_, i) => ({ text: `O${i}` }));
  assert.deepEqual(fields(form({ optionen: viele })), {
    optionen: `Höchstens ${MAX_ABSTIMMUNG_OPTIONEN} Optionen. Bitte nimm welche heraus.`,
  });
  assert.equal(form({ optionen: viele.slice(1) })().optionen.length, MAX_ABSTIMMUNG_OPTIONEN);
});

test('validateAbstimmungName trims and collapses the name', () => {
  assert.equal(validateAbstimmungName(' Lea \t  Muster '), 'Lea Muster');
  for (const value of [undefined, null, 4, '  ']) {
    assert.deepEqual(
      fields(() => validateAbstimmungName(value)),
      { name: 'Dein Name fehlt.' }
    );
  }
  assert.deepEqual(
    fields(() => validateAbstimmungName('x'.repeat(101))),
    {
      name: 'Dein Name darf höchstens 100 Zeichen haben.',
    }
  );
  assert.equal(validateAbstimmungName(` ${'x'.repeat(100)} `).length, 100);
});

const REGELN: AbstimmungRegeln = {
  optionIds: [1, 2, 3],
  maxAuswahl: null,
  vielleichtErlaubt: true,
};
const antwort = (gewaehlt: unknown, vielleicht: unknown, regeln = REGELN) =>
  fields(() => validateAntwort(gewaehlt, vielleicht, regeln));

test('validateAntwort orders the answer like the options and treats missing Vielleicht as empty', () => {
  assert.deepEqual(validateAntwort([3, 1, 1], [2], REGELN), { gewaehlt: [1, 3], vielleicht: [2] });
  assert.deepEqual(validateAntwort([], undefined, REGELN), { gewaehlt: [], vielleicht: [] });
  assert.deepEqual(validateAntwort([], null, { ...REGELN, vielleichtErlaubt: false }), {
    gewaehlt: [],
    vielleicht: [],
  });
});

test('validateAntwort reports the messages of every rule under gewaehlt', () => {
  const neu = 'Die Auswahl ist ungültig. Bitte lade die Seite neu.';
  const weg = 'Eine Option gibt es nicht mehr. Bitte lade die Seite neu.';
  for (const value of ['1', undefined, null, {}, 3]) {
    assert.deepEqual(antwort(value, []), { gewaehlt: neu });
  }
  assert.deepEqual(antwort([1], 'x'), { gewaehlt: neu });
  assert.deepEqual(antwort([1, 1, 1, 1], []), { gewaehlt: neu });
  // Too long wins over an unknown entry, as the length is checked first
  assert.deepEqual(antwort([9, 9, 9, 9], []), { gewaehlt: neu });
  assert.deepEqual(antwort([9], []), { gewaehlt: weg });
  assert.deepEqual(antwort(['1'], []), { gewaehlt: weg });
  assert.deepEqual(antwort([1], [9]), { gewaehlt: weg });
  assert.deepEqual(antwort([1], [1]), { gewaehlt: neu });
  assert.deepEqual(antwort([1], [2], { ...REGELN, vielleichtErlaubt: false }), {
    gewaehlt: '„Vielleicht“ geht bei dieser Abstimmung nicht mehr. Bitte lade die Seite neu.',
  });
  assert.deepEqual(antwort([1, 2], [], { ...REGELN, maxAuswahl: 1 }), {
    gewaehlt: 'Hier kannst du nur eine Option wählen.',
  });
  assert.deepEqual(antwort([1, 2, 3], [], { ...REGELN, maxAuswahl: 2 }), {
    gewaehlt: 'Hier kannst du höchstens 2 Optionen mit „Ja“ wählen.',
  });
  assert.deepEqual(validateAntwort([1, 2], [3], { ...REGELN, maxAuswahl: 2 }), {
    gewaehlt: [1, 2],
    vielleicht: [3],
  });
});
