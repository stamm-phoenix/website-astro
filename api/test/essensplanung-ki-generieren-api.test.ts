import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import * as endpoints from '../endpoints/essensplanung';
import * as ki from '../endpoints/essensplanung-ki';
import { getDb } from '../lib/db';
import type { KiGericht } from '../lib/essen-ki-model';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

/**
 * „Gericht generieren lassen (KI)“ against the database, with a mocked deployment (no real
 * calls): the written dish and taking it over with instructions and tools in one change.
 */

async function zentraleZutat(name: string): Promise<number> {
  const row = await getDb()
    .selectFrom('essen.zutat')
    .select('id')
    .where('name', '=', name)
    .executeTakeFirstOrThrow();
  return row.id;
}

async function gericht(t: TestContext, token: string, personen: number | null) {
  const antwort = await call(t, endpoints.EssensplanungGerichte, 'POST', 'planung/gerichte', {
    token,
    body: { name: 'Chili', personen, anleitung: '', werkzeuge: ['Kelle'] },
  });
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  return json<{ id: number }>(antwort).id;
}

async function ansichtVon(t: TestContext, token: string): Promise<PlanungAnsicht> {
  return json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
}

function modell(t: TestContext, antwort: unknown): void {
  const previous = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previous === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previous;
  });
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ choices: [{ message: { content: JSON.stringify(antwort) } }] })
  );
}

function sammel(t: TestContext, token: string, id: number, body: Record<string, unknown>) {
  return call(
    t,
    ki.EssensplanungGerichtZutatenSammel,
    'POST',
    `planung/gerichte/${id}/zutaten/sammel`,
    { token, params: { id: String(id) }, body }
  );
}

dbTest('a dish is written from a description and nothing is saved', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const id = await gericht(t, token, null);
  modell(t, {
    rezeptPersonen: 12,
    zeilen: [
      {
        original: '1,5 kg Zwiebeln',
        name: 'Zwiebeln',
        key: null,
        menge: 1.5,
        einheit: 'kg',
        einheitRezept: 'kg',
        hinweis: 'gewürfelt',
        inhaltMenge: null,
        inhaltEinheit: null,
      },
    ],
    anleitung: '1. Zwiebeln anbraten.',
    werkzeuge: ['Großer Topf'],
  });
  const generieren = (body: unknown) =>
    call(t, ki.EssensplanungKiGenerieren, 'POST', `planung/gerichte/${id}/ki/generieren`, {
      token,
      params: { id: String(id) },
      body,
    });
  assert.equal((await generieren({ beschreibung: '  ' })).status, 400);
  assert.equal((await generieren({ beschreibung: 'x'.repeat(2001) })).status, 400);
  const antwort = await generieren({ beschreibung: 'Chili sin Carne' });
  assert.equal(antwort.status, 200, JSON.stringify(antwort.jsonBody));
  const geschrieben = json<KiGericht>(antwort);
  assert.equal(geschrieben.rezeptPersonen, 12);
  assert.equal(geschrieben.personen, null);
  // The same name as in the list counts, though the model gave no key
  assert.deepEqual(geschrieben.zeilen[0].zutat, { zutatId: await zentraleZutat('Zwiebeln') });
  assert.equal(geschrieben.anleitung, '1. Zwiebeln anbraten.');
  assert.deepEqual(geschrieben.werkzeuge, ['Großer Topf']);
  const ansicht = await ansichtVon(t, token);
  const dish = ansicht.gerichte.find((g) => g.id === id)!;
  assert.equal(dish.zutaten.length, 0);
  assert.equal(dish.anleitung, '');
});

dbTest('lines, people, instructions and tools are taken over in one change', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const id = await gericht(t, token, null);
  const zwiebeln = await zentraleZutat('Zwiebeln');
  const vorher = (await ansichtVon(t, token)).gerichte.find((g) => g.id === id)!;

  const antwort = await sammel(t, token, id, {
    zeilen: [{ zutatId: zwiebeln, menge: 1500, einheit: 'g' }],
    personen: null,
    personenSetzen: 12,
    kopf: { etag: vorher.etag, anleitung: '1. Anbraten.', werkzeuge: ['Kelle', 'Großer Topf'] },
  });
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  const ansicht = json<PlanungAnsicht>(antwort);
  const dish = ansicht.gerichte.find((g) => g.id === id)!;
  assert.equal(dish.personen, 12);
  assert.equal(dish.anleitung, '1. Anbraten.');
  assert.deepEqual(dish.werkzeuge, ['Kelle', 'Großer Topf']);
  assert.equal(dish.zutaten.length, 1);
  assert.equal(ansicht.aenderungen[0].aktion, 'gericht-zutaten-neu');
  assert.deepEqual(ansicht.aenderungen[0].details.kopf, ['Anleitung', 'Werkzeuge']);

  // The old version is stale now: nothing is added, not even the lines
  const alt = await sammel(t, token, id, {
    zeilen: [{ zutatId: zwiebeln, menge: 100, einheit: 'g' }],
    kopf: { etag: vorher.etag, anleitung: 'Anders.' },
  });
  assert.equal(alt.status, 409, JSON.stringify(alt.jsonBody));
  const danach = (await ansichtVon(t, token)).gerichte.find((g) => g.id === id)!;
  assert.equal(danach.zutaten.length, 1);
  assert.equal(danach.anleitung, '1. Anbraten.');

  // Instructions alone need no line
  const nurKopf = await sammel(t, token, id, {
    zeilen: [],
    kopf: { etag: danach.etag, anleitung: '1. Neu.' },
  });
  assert.equal(nurKopf.status, 201, JSON.stringify(nurKopf.jsonBody));
  assert.equal(
    json<PlanungAnsicht>(nurKopf).gerichte.find((g) => g.id === id)!.anleitung,
    '1. Neu.'
  );
  // Without them a batch still needs a line
  assert.equal((await sammel(t, token, id, { zeilen: [] })).status, 400);
});
