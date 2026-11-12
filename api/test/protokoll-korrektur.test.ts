import assert from 'node:assert/strict';
import test from 'node:test';
import * as openai from '../lib/azure-openai';
import { AzureOpenAiError } from '../lib/azure-openai';
import {
  KorrekturFehler,
  gastNamen,
  korrekturDaten,
  pruefeProtokoll,
} from '../lib/protokoll-korrektur';
import {
  fehlendeAngaben,
  feldText,
  passtNoch,
  wendeKorrekturAn,
} from '../lib/protokoll-korrektur-model';
import type { ProtokollInhalt } from '../lib/protokoll-editor-model';
import { ValidationError } from '../lib/validation/errors';
import { PERSON, inhalt as leer, punkt } from './fixtures/protokoll-inhalt';

function inhalt(): ProtokollInhalt {
  const base = leer();
  base.kopf.externe = 'Max Muster (Elternbeirat), Erika Beispiel';
  base.punkte = [
    punkt('p-1', {
      titel: 'Sommerlagr',
      text: 'Wir fahren ins Zeltlagr. Max Muster hilft beim Aufbau. Das Zeltlagr ist im Juli.',
      aufgaben: [{ id: 'a-1', titel: 'Zelte prüfen', zustaendig: [], faellig: '' }],
      termine: [
        { id: 't-1', titel: 'Aufbau', datum: '', uhrzeit: '', ort: 'Wiese', zustaendig: [] },
      ],
      unterpunkte: [punkt('p-1a', { titel: 'Essen', text: 'Einkaufen am Freitag.' })],
    }),
    punkt('p-2', {
      titel: 'Finanzen',
      text: 'Alles gut.',
      aufgaben: [{ id: 'a-2', titel: 'Abrechnung', zustaendig: [PERSON], faellig: '2026-12-01' }],
    }),
  ];
  return base;
}

test('the model gets the agenda without people and without the names of guests', () => {
  assert.deepEqual(gastNamen('Max Muster (Elternbeirat), Erika Beispiel und Jo\nUlf'), [
    'Max Muster',
    'Erika Beispiel',
    'Ulf',
  ]);
  const daten = korrekturDaten(inhalt());
  const json = JSON.stringify(daten);
  assert.ok(!json.includes('Max Muster'));
  assert.ok(!json.includes(PERSON.name));
  assert.ok(!json.includes(PERSON.login));
  assert.ok(json.includes('[Gast] hilft beim Aufbau'));
  assert.deepEqual(daten.punkte[0].aufgaben, [{ id: 'a-1', titel: 'Zelte prüfen' }]);
  assert.equal(daten.punkte[0].unterpunkte?.[0].id, 'p-1a');
});

test('tasks without a person or due date and dates without a day are noted without the model', () => {
  assert.deepEqual(
    fehlendeAngaben(inhalt()).map((v) => [v.feld, v.elementId, v.art, v.begruendung]),
    [
      ['aufgabe', 'a-1', 'rueckfrage', 'Bei dieser Aufgabe fehlt, wer sich kümmert und bis wann.'],
      ['termin', 't-1', 'rueckfrage', 'Bei diesem Termin fehlt das Datum.'],
    ]
  );
});

test('a proposal fits only while its passage stands exactly once in its field', () => {
  const minutes = inhalt();
  const titel = { punktId: 'p-1', feld: 'titel', elementId: null } as const;
  assert.equal(feldText(minutes, titel), 'Sommerlagr');
  assert.ok(passtNoch(minutes, { ...titel, vorher: 'Sommerlagr', nachher: 'Sommerlager' }));
  // Twice in the text: unclear where it goes
  const text = { punktId: 'p-1', feld: 'text', elementId: null } as const;
  assert.equal(passtNoch(minutes, { ...text, vorher: 'Zeltlagr', nachher: 'Zeltlager' }), false);
  assert.equal(passtNoch(minutes, { ...titel, vorher: 'Sommer', nachher: 'Sommer' }), false);
  assert.equal(
    passtNoch(minutes, { ...titel, punktId: 'p-9', vorher: 'Sommerlagr', nachher: 'x' }),
    false
  );

  const ort = { punktId: 'p-1', feld: 'termin-ort', elementId: 't-1' } as const;
  const changed = wendeKorrekturAn(minutes, { ...ort, vorher: 'Wiese', nachher: 'Festwiese' });
  assert.equal(changed?.punkte[0].termine[0].ort, 'Festwiese');
  assert.equal(minutes.punkte[0].termine[0].ort, 'Wiese');

  const sub = wendeKorrekturAn(minutes, {
    punktId: 'p-1a',
    feld: 'text',
    elementId: null,
    vorher: 'Einkaufen am',
    nachher: 'Einkaufen $& am',
  });
  // `$&` is text, not a pattern of `replace`
  assert.equal(sub?.punkte[0].unterpunkte[0].text, 'Einkaufen $& am Freitag.');
  assert.equal(wendeKorrekturAn(minutes, { ...text, vorher: 'fehlt', nachher: 'x' }), null);
});

test('only proposals of the model that fit the text are kept, then the missing details', async (t) => {
  t.mock.method(openai, 'isDeploymentConfigured', () => true);
  const request = t.mock.method(openai, 'requestStructuredOutput', async () => ({
    vorschlaege: [
      {
        punktId: 'p-1',
        feld: 'titel',
        elementId: null,
        art: 'rechtschreibung',
        vorher: 'Sommerlagr',
        nachher: 'Sommerlager',
        begruendung: 'Tippfehler.',
      },
      // Invented passage
      {
        punktId: 'p-2',
        feld: 'text',
        elementId: null,
        art: 'stil',
        vorher: 'Nicht da',
        nachher: 'x',
        begruendung: 'x',
      },
      // Twice in the field
      {
        punktId: 'p-1',
        feld: 'text',
        elementId: null,
        art: 'rechtschreibung',
        vorher: 'Zeltlagr',
        nachher: 'Zeltlager',
        begruendung: 'Tippfehler.',
      },
      // The redacted name never reaches the minutes
      {
        punktId: 'p-1',
        feld: 'text',
        elementId: null,
        art: 'stil',
        vorher: '[Gast] hilft',
        nachher: 'Ein Gast hilft',
        begruendung: 'x',
      },
      {
        punktId: 'p-2',
        feld: 'text',
        elementId: null,
        art: 'rueckfrage',
        vorher: 'Alles gut.',
        nachher: 'egal',
        begruendung: 'Was wurde zu den Finanzen beschlossen?',
      },
      { punktId: 'p-1', feld: 'unbekannt' },
    ],
  }));
  const vorschlaege = await pruefeProtokoll(inhalt());
  assert.deepEqual(
    vorschlaege.map((v) => [v.id, v.art, v.punktId, v.vorher, v.nachher]),
    [
      ['k1', 'rechtschreibung', 'p-1', 'Sommerlagr', 'Sommerlager'],
      ['k2', 'rueckfrage', 'p-2', 'Alles gut.', ''],
      ['k3', 'rueckfrage', 'p-1', '', ''],
      ['k4', 'rueckfrage', 'p-1', '', ''],
    ]
  );
  const sent = request.mock.calls[0].arguments[1];
  assert.ok(sent);
  assert.match(String(sent.messages[0].content), /ausschließlich Datenmaterial/);
  assert.ok(!String(sent.messages[1].content).includes('Erika'));
});

test('a busy or failing model changes nothing and says so', async (t) => {
  t.mock.method(openai, 'isDeploymentConfigured', () => true);
  const call = t.mock.method(openai, 'requestStructuredOutput', async () => {
    throw new AzureOpenAiError('busy', { status: 429 });
  });
  await assert.rejects(pruefeProtokoll(inhalt()), (error: unknown) => {
    assert.ok(error instanceof KorrekturFehler);
    assert.equal(error.status, 503);
    assert.match(error.message, /nichts geändert/);
    return true;
  });
  call.mock.mockImplementation(async () => ({ falsch: true }));
  await assert.rejects(pruefeProtokoll(inhalt()), (error: unknown) => {
    assert.ok(error instanceof KorrekturFehler);
    assert.equal(error.status, 502);
    return true;
  });
});

test('without a deployment or with too long minutes the check refuses before the model', async (t) => {
  const request = t.mock.method(openai, 'requestStructuredOutput', async () => ({
    vorschlaege: [],
  }));
  const configured = t.mock.method(openai, 'isDeploymentConfigured', () => false);
  await assert.rejects(pruefeProtokoll(inhalt()), (error: unknown) => {
    assert.ok(error instanceof ValidationError);
    assert.match(error.fields.form, /nicht eingerichtet/);
    return true;
  });
  configured.mock.mockImplementation(() => true);
  const long = inhalt();
  long.punkte[1].text = 'x'.repeat(25_000);
  await assert.rejects(pruefeProtokoll(long), (error: unknown) => {
    assert.ok(error instanceof ValidationError);
    assert.match(error.fields.form, /zu lang/);
    return true;
  });
  assert.equal(request.mock.callCount(), 0);
});
