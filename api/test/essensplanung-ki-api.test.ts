import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import * as endpoints from '../endpoints/essensplanung';
import * as ki from '../endpoints/essensplanung-ki';
import { getDb } from '../lib/db';
import type { KiPruefung, KiUmrechnung } from '../lib/essen-ki-model';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

/**
 * The endpoints of the AI and the batch of recipe lines, against the database, with a mocked
 * deployment (no real calls).
 */

async function zentraleZutat(name: string): Promise<number> {
  const row = await getDb()
    .selectFrom('essen.zutat')
    .select('id')
    .where('name', '=', name)
    .executeTakeFirstOrThrow();
  return row.id;
}

async function gericht(t: TestContext, token: string): Promise<number> {
  const antwort = await call(t, endpoints.EssensplanungGerichte, 'POST', 'planung/gerichte', {
    token,
    body: { name: 'Chili', personen: 10 },
  });
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  return json<{ id: number }>(antwort).id;
}

function sammel(t: TestContext, token: string, id: number, zeilen: unknown) {
  return call(
    t,
    ki.EssensplanungGerichtZutatenSammel,
    'POST',
    `planung/gerichte/${id}/zutaten/sammel`,
    { token, params: { id: String(id) }, body: { zeilen } }
  );
}

function modell(t: TestContext, antwort: () => Response): void {
  const previous = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previous === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previous;
  });
  t.mock.method(globalThis, 'fetch', async () => antwort());
}

const inhalt = (value: unknown) =>
  Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });

dbTest('recipe lines are added in one change, all or none', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const id = await gericht(t, token);
  const zwiebel = await zentraleZutat('Zwiebeln');
  const milch = await zentraleZutat('H-Milch');

  const leer = await sammel(t, token, id, []);
  assert.equal(leer.status, 400);
  assert.ok(json<{ fields: Record<string, string> }>(leer).fields.zeilen);

  // Milk is measured in ml: the third line fails, and so do the two before it
  const falsch = await sammel(t, token, id, [
    { zutatId: zwiebel, menge: 500, einheit: 'g' },
    { zutatId: milch, menge: 1, einheit: 'l' },
    { zutatId: milch, menge: 200, einheit: 'g' },
  ]);
  assert.equal(falsch.status, 400, JSON.stringify(falsch.jsonBody));
  assert.ok(json<{ fields: Record<string, string> }>(falsch).fields['zeilen.2.einheit']);
  const ungueltig = await sammel(t, token, id, [{ zutatId: zwiebel, menge: -1, einheit: 'g' }]);
  assert.ok(json<{ fields: Record<string, string> }>(ungueltig).fields['zeilen.0.menge']);

  const antwort = await sammel(t, token, id, [
    { zutatId: zwiebel, menge: 500, einheit: 'g', hinweis: 'gehackt' },
    { zutatId: milch, menge: 1, einheit: 'l', fuerVegan: false },
  ]);
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  const ansicht = json<PlanungAnsicht>(antwort);
  const zeilen = ansicht.gerichte.find((g) => g.id === id)!.zutaten;
  assert.deepEqual(
    zeilen.map((zeile) => [zeile.position, zeile.menge, zeile.einheit, zeile.fuerVegan]),
    [
      [1, 500, 'g', true],
      [2, 1, 'l', false],
    ]
  );
  assert.equal(ansicht.aenderungen[0].aktion, 'gericht-zutaten-neu');
});

dbTest('the AI is only for members who edit, outside the maintenance mode', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const id = await gericht(t, token);
  let aufrufe = 0;
  modell(t, () => {
    aufrufe++;
    return inhalt({ hinweise: [] });
  });
  const pruefen = (mit: string) =>
    call(t, ki.EssensplanungKiPruefen, 'POST', `planung/gerichte/${id}/ki/pruefen`, {
      token: mit,
      params: { id: String(id) },
    });
  const lesen = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungLinks, 'POST', 'planung/links', {
      token,
      body: { art: 'lesen', an: true },
    })
  ).links!.lesen!;
  assert.equal((await pruefen(lesen)).status, 403);

  await getDb().updateTable('essen.einstellungen').set({ wartung: true }).execute();
  t.after(async () => {
    await getDb().updateTable('essen.einstellungen').set({ wartung: false }).execute();
  });
  assert.equal((await pruefen(token)).status, 503);
  assert.equal(aufrufe, 0);
  await getDb().updateTable('essen.einstellungen').set({ wartung: false }).execute();

  const ok = await pruefen(token);
  assert.equal(ok.status, 200, JSON.stringify(ok.jsonBody));
  assert.deepEqual(json<KiPruefung>(ok), { hinweise: [], personen: 10 });
  assert.equal(aufrufe, 1);
});

dbTest('a busy deployment answers 429 with Retry-After for the page', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const id = await gericht(t, token);
  modell(t, () => new Response('quota', { status: 429, headers: { 'Retry-After': '20' } }));
  const antwort = await call(
    t,
    ki.EssensplanungKiRezept,
    'POST',
    `planung/gerichte/${id}/ki/rezept`,
    {
      token,
      params: { id: String(id) },
      body: { text: '500 g Zwiebeln' },
    }
  );
  assert.equal(antwort.status, 429);
  assert.equal((antwort.headers as Record<string, string>)['Retry-After'], '20');
  const body = json<{ code: string; message: string; retryAfter: number }>(antwort);
  assert.equal(body.code, 'KI_NICHT_VERFUEGBAR');
  assert.equal(body.retryAfter, 20);
  assert.match(body.message, /KI gerade nicht verfügbar/);
});

dbTest('grams are estimated only for food measured by weight', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  modell(t, () => inhalt({ gramm: 80, begruendung: 'Eine mittelgroße Zwiebel.' }));
  const schaetzen = (body: unknown) =>
    call(t, ki.EssensplanungKiUmrechnung, 'POST', 'planung/ki/umrechnung', { token, body });
  const zwiebel = await schaetzen({ zutatId: await zentraleZutat('Zwiebeln'), mass: 'stueck' });
  assert.equal(zwiebel.status, 200, JSON.stringify(zwiebel.jsonBody));
  assert.deepEqual(json<KiUmrechnung>(zwiebel), {
    mass: 'stueck',
    gramm: 80,
    begruendung: 'Eine mittelgroße Zwiebel.',
  });
  assert.equal(
    (await schaetzen({ zutatId: await zentraleZutat('H-Milch'), mass: 'el' })).status,
    400
  );
  assert.equal((await schaetzen({ zutatId: 1, mass: 'tasse' })).status, 400);
});

dbTest('recipe lines scaled for other people than the dish has now are refused', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const id = await gericht(t, token);
  const zwiebeln = await zentraleZutat('Zwiebeln');
  const ansicht = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  // Someone changes the people while the preview is open
  const geaendert = await call(
    t,
    endpoints.EssensplanungGericht,
    'PATCH',
    `planung/gerichte/${id}`,
    {
      token,
      params: { id: String(id) },
      body: { etag: ansicht.gerichte.find((g) => g.id === id)!.etag, personen: 20 },
    }
  );
  assert.equal(geaendert.status, 200, JSON.stringify(geaendert.jsonBody));
  const zeilen = [{ zutatId: zwiebeln, menge: 500, einheit: 'g' }];
  const alt = await call(
    t,
    ki.EssensplanungGerichtZutatenSammel,
    'POST',
    `planung/gerichte/${id}/zutaten/sammel`,
    { token, params: { id: String(id) }, body: { zeilen, personen: 10 } }
  );
  assert.equal(alt.status, 409, JSON.stringify(alt.jsonBody));
  assert.equal(json<{ code: string }>(alt).code, 'PERSONEN_GEAENDERT');
  const danach = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  assert.equal(danach.gerichte.find((g) => g.id === id)!.zutaten.length, 0);
  const neu = await call(
    t,
    ki.EssensplanungGerichtZutatenSammel,
    'POST',
    `planung/gerichte/${id}/zutaten/sammel`,
    { token, params: { id: String(id) }, body: { zeilen, personen: 20 } }
  );
  assert.equal(neu.status, 201, JSON.stringify(neu.jsonBody));
});

dbTest('a proposed amount is refused once the people of the dish changed', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const id = await gericht(t, token);
  const zwiebeln = await zentraleZutat('Zwiebeln');
  const angelegt = await call(
    t,
    endpoints.EssensplanungGerichtZutaten,
    'POST',
    `planung/gerichte/${id}/zutaten`,
    { token, params: { id: String(id) }, body: { zutatId: zwiebeln, menge: 500, einheit: 'g' } }
  );
  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.jsonBody));
  const vorher = json<PlanungAnsicht>(angelegt).gerichte.find((g) => g.id === id)!;
  const zeile = vorher.zutaten[0];
  // The dish is checked for 10 people; then someone changes them to 20
  const geaendert = await call(
    t,
    endpoints.EssensplanungGericht,
    'PATCH',
    `planung/gerichte/${id}`,
    {
      token,
      params: { id: String(id) },
      body: { etag: vorher.etag, personen: 20 },
    }
  );
  assert.equal(geaendert.status, 200, JSON.stringify(geaendert.jsonBody));
  const zeileAendern = (body: Record<string, unknown>) =>
    call(t, endpoints.EssensplanungGerichtZutat, 'PATCH', `planung/gericht-zutaten/${zeile.id}`, {
      token,
      params: { id: String(zeile.id) },
      body: { planungZutatId: zeile.planungZutatId, einheit: 'g', etag: zeile.etag, ...body },
    });
  const vorschlag = await zeileAendern({ menge: 1000, personen: 10 });
  assert.equal(vorschlag.status, 409, JSON.stringify(vorschlag.jsonBody));
  assert.equal(json<{ code: string }>(vorschlag).code, 'PERSONEN_GEAENDERT');
  // A change of the line without people works as before
  const normal = await zeileAendern({ menge: 700 });
  assert.equal(normal.status, 200, JSON.stringify(normal.jsonBody));
  assert.equal(
    json<PlanungAnsicht>(normal).gerichte.find((g) => g.id === id)!.zutaten[0].menge,
    700
  );
});
