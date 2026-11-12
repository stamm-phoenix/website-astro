import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../lib/validation/errors';
import {
  parseKorrekturAntwort,
  validateKorrekturUebernahme,
} from '../lib/validation/protokoll-korrektur';

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const VORSCHLAG = {
  id: 'k1',
  punktId: 'p-1',
  feld: 'text',
  vorher: ' Zeltlagr ',
  nachher: ' Zeltlager ',
};

test('taking proposals over keeps the passages exactly as sent', () => {
  assert.deepEqual(validateKorrekturUebernahme({ etag: 'v1', vorschlaege: [VORSCHLAG] }), {
    etag: 'v1',
    vorschlaege: [{ ...VORSCHLAG, elementId: null }],
  });
});

test('taking proposals over: German messages per field', () => {
  assert.deepEqual(
    fields(() => validateKorrekturUebernahme(null)),
    {
      etag: 'Bitte Die Version angeben.',
      vorschlaege: 'Bitte mindestens einen Vorschlag auswählen.',
    }
  );
  assert.deepEqual(
    fields(() => validateKorrekturUebernahme({ etag: 'v1', vorschlaege: [] })),
    { vorschlaege: 'Bitte mindestens einen Vorschlag auswählen.' }
  );
  for (const broken of [
    { ...VORSCHLAG, feld: 'kopf' },
    { ...VORSCHLAG, punktId: 'P 1' },
    { ...VORSCHLAG, vorher: '' },
    { ...VORSCHLAG, nachher: 3 },
    'k1',
  ]) {
    assert.deepEqual(
      fields(() => validateKorrekturUebernahme({ etag: 'v1', vorschlaege: [broken] })),
      { vorschlaege: 'Der Vorschlag ist ungültig. Lass das Protokoll noch einmal prüfen.' }
    );
  }
  assert.deepEqual(
    fields(() =>
      validateKorrekturUebernahme({ etag: 'v1', vorschlaege: Array(61).fill(VORSCHLAG) })
    ),
    { vorschlaege: 'Es lassen sich höchstens 60 Vorschläge auf einmal übernehmen.' }
  );
});

test('the answer of the model keeps the entries that fit the schema', () => {
  assert.throws(() => parseKorrekturAntwort({}));
  assert.deepEqual(
    parseKorrekturAntwort({
      vorschlaege: [
        {
          punktId: 'p-1',
          feld: 'aufgabe',
          elementId: 'a-1',
          art: 'rechtschreibung',
          vorher: 'Zelt',
          nachher: 'Zelte',
          begruendung: '  Mehrzahl.\n',
        },
        { punktId: 'p-1', feld: 'text', elementId: null, art: 'neu', vorher: 'a', nachher: 'b' },
        {
          punktId: 'p-1',
          feld: 'text',
          elementId: null,
          art: 'stil',
          vorher: 'a',
          nachher: 'b',
          begruendung: ' ',
        },
      ],
    }),
    [
      {
        punktId: 'p-1',
        feld: 'aufgabe',
        elementId: 'a-1',
        art: 'rechtschreibung',
        vorher: 'Zelt',
        nachher: 'Zelte',
        begruendung: 'Mehrzahl.',
      },
    ]
  );
});
