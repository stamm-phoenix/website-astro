import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import {
  EssensplanungGerichte,
  EssensplanungGerichtZutaten,
  EssensplanungKatalog,
  EssensplanungZutat,
} from '../endpoints/essensplanung-gerichte';
import { EssensplanungKiZutaten } from '../endpoints/essensplanung-ki';
import { getDb } from '../lib/db';
import type { EssenKatalog, PlanungZutat } from '../lib/essen-gerichte-model';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

/**
 * „Zutaten schnell anlegen“: a line with a name in neither list adds an ingredient of the
 * Planung's own with stand-ins, and the AI fills in what is open (mocked deployment).
 */

async function gericht(t: TestContext, token: string): Promise<number> {
  const antwort = await call(t, EssensplanungGerichte, 'POST', 'planung/gerichte', {
    token,
    body: { name: 'Gemüsepfanne', personen: 10 },
  });
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  return json<{ id: number }>(antwort).id;
}

async function zeile(t: TestContext, token: string, gerichtId: number, body: unknown) {
  const antwort = await call(
    t,
    EssensplanungGerichtZutaten,
    'POST',
    `planung/gerichte/${gerichtId}/zutaten`,
    { token, params: { id: String(gerichtId) }, body }
  );
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  return json<PlanungAnsicht>(antwort);
}

function modell(t: TestContext, antwort: () => unknown): { aufrufe: number } {
  const zaehler = { aufrufe: 0 };
  const previous = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previous === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previous;
  });
  t.mock.method(globalThis, 'fetch', async () => {
    zaehler.aufrufe++;
    return Response.json({ choices: [{ message: { content: JSON.stringify(antwort()) } }] });
  });
  return zaehler;
}

const finde = (ansicht: PlanungAnsicht, name: string): PlanungZutat =>
  ansicht.zutaten.find((zutat) => zutat.name === name)!;

dbTest('a new name adds an ingredient of its own, and the AI fills in what is open', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const id = await gericht(t, token);
  const katalog = json<EssenKatalog>(
    await call(t, EssensplanungKatalog, 'GET', 'planung/katalog', { token })
  );
  const sonstiges = katalog.kategorien.find((k) => k.name === 'Sonstiges')!.id;

  // The unit of the amount tells the kind of unit; the rest are stand-ins
  let ansicht = await zeile(t, token, id, { neueZutat: 'Zucchini', menge: 2, einheit: 'kg' });
  const zucchini = finde(ansicht, 'Zucchini');
  assert.equal(zucchini.zutatId, null);
  assert.equal(zucchini.lebensmittel, true);
  assert.equal(zucchini.einheitenart, 'masse');
  assert.equal(zucchini.kategorieId, sonstiges);
  assert.equal(zucchini.vegetarisch, null);
  assert.equal(zucchini.angaben, 'offen');
  assert.equal(ansicht.gerichte[0].zutaten[0].planungZutatId, zucchini.id);

  // The same name again, in other case, is the same ingredient; a name of the list is that one
  ansicht = await zeile(t, token, id, { neueZutat: 'zucchini', menge: 1, einheit: 'stueck' });
  assert.equal(ansicht.zutaten.filter((z) => z.name.toLowerCase() === 'zucchini').length, 1);
  ansicht = await zeile(t, token, id, { neueZutat: 'Zwiebeln', menge: 3, einheit: 'stueck' });
  assert.notEqual(finde(ansicht, 'Zwiebeln').zutatId, null);

  // Without a known unit it counts in pieces until the AI says otherwise
  ansicht = await zeile(t, token, id, { neueZutat: 'Hokkaido', menge: null, einheit: null });
  const hokkaido = finde(ansicht, 'Hokkaido');
  assert.equal(hokkaido.einheitenart, 'stueck');

  const gemuese = katalog.kategorien.find((k) => k.id !== sonstiges)!.id;
  const gluten = katalog.unvertraeglichkeiten[0].id;
  const zaehler = modell(t, () => ({
    zutaten: [
      // The kind of unit of Zucchini came from its line and stays
      {
        schluessel: `z${zucchini.id}`,
        kategorie: gemuese,
        einheitenart: 'stueck',
        ernaehrung: 'vegan',
        allergene: [],
      },
      {
        schluessel: `z${hokkaido.id}`,
        kategorie: 99_999,
        einheitenart: 'masse',
        ernaehrung: 'vegetarisch',
        allergene: [gluten, 12_345],
      },
      // Another Planung's ingredient is not asked about
      { schluessel: 'z1', kategorie: gemuese, einheitenart: 'masse', ernaehrung: 'fleisch' },
    ],
  }));
  const antwort = await call(t, EssensplanungKiZutaten, 'POST', 'planung/ki/zutaten', { token });
  assert.equal(antwort.status, 200, JSON.stringify(antwort.jsonBody));
  const ergebnis = json<{ ansicht: PlanungAnsicht; ergaenzt: string[] }>(antwort);
  assert.deepEqual(ergebnis.ergaenzt.sort(), ['Hokkaido', 'Zucchini']);
  const z = finde(ergebnis.ansicht, 'Zucchini');
  assert.deepEqual(
    [z.kategorieId, z.einheitenart, z.vegetarisch, z.vegan, z.allergene, z.angaben],
    [gemuese, 'masse', true, true, [], 'ki']
  );
  const h = finde(ergebnis.ansicht, 'Hokkaido');
  assert.deepEqual(
    [h.kategorieId, h.einheitenart, h.vegetarisch, h.vegan, h.allergene, h.angaben],
    [sonstiges, 'masse', true, false, [gluten], 'ki']
  );

  // Nothing open: the AI is not asked again
  const nochmal = await call(t, EssensplanungKiZutaten, 'POST', 'planung/ki/zutaten', { token });
  assert.deepEqual(json<{ ergaenzt: string[] }>(nochmal).ergaenzt, []);
  assert.equal(zaehler.aufrufe, 1);

  // Saving the ingredient checks its details
  const gespeichert = json<PlanungAnsicht>(
    await call(t, EssensplanungZutat, 'PATCH', `planung/zutaten/${h.id}`, {
      token,
      params: { id: String(h.id) },
      body: {
        etag: h.etag,
        name: 'Hokkaido',
        kategorieId: gemuese,
        einheitenart: 'masse',
        vegetarisch: true,
        vegan: true,
        allergene: [],
      },
    })
  );
  assert.equal(finde(gespeichert, 'Hokkaido').angaben, 'geprueft');
  const log = await getDb()
    .selectFrom('essen.aenderung')
    .select('aktion')
    .where('aktion', '=', 'zutat-ki')
    .execute();
  assert.equal(log.length, 1);
});

dbTest('an ingredient changed while the AI thinks keeps its values', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const id = await gericht(t, token);
  const ansicht = await zeile(t, token, id, { neueZutat: 'Pastinake', menge: 1, einheit: 'kg' });
  const pastinake = finde(ansicht, 'Pastinake');
  const katalog = json<EssenKatalog>(
    await call(t, EssensplanungKatalog, 'GET', 'planung/katalog', { token })
  );
  const [erste, letzte] = [katalog.kategorien[0].id, katalog.kategorien.at(-1)!.id];
  const previous = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previous === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previous;
  });
  t.mock.method(globalThis, 'fetch', async () => {
    // Someone changes the ingredient while the question runs
    await getDb()
      .updateTable('essen.planung_zutat')
      .set({ kategorie_id: letzte })
      .where('id', '=', pastinake.id)
      .execute();
    const antwort = {
      zutaten: [
        {
          schluessel: `z${pastinake.id}`,
          kategorie: erste,
          einheitenart: 'masse',
          ernaehrung: 'fleisch',
          allergene: [],
        },
      ],
    };
    return Response.json({ choices: [{ message: { content: JSON.stringify(antwort) } }] });
  });
  const antwort = await call(t, EssensplanungKiZutaten, 'POST', 'planung/ki/zutaten', { token });
  assert.equal(antwort.status, 200, JSON.stringify(antwort.jsonBody));
  const ergebnis = json<{ ansicht: PlanungAnsicht; ergaenzt: string[] }>(antwort);
  assert.deepEqual(ergebnis.ergaenzt, []);
  const p = finde(ergebnis.ansicht, 'Pastinake');
  assert.deepEqual([p.kategorieId, p.vegetarisch, p.angaben], [letzte, null, 'offen']);
});
