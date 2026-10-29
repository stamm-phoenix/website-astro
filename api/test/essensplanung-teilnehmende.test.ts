import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import * as endpoints from '../endpoints/essensplanung';
import { getDb } from '../lib/db';
import {
  seedPreviewEssensplanungPlanung,
  seedPreviewEssensplanungTeilnehmende,
} from '../lib/db-preview';
import { planungLoeschen, ladeZugang } from '../lib/essen-planung';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { mahlzeitStand, tagStand } from '../lib/essen-planung-model';
import { esserJeMahlzeit } from '../lib/essen-teilnehmende-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

function gruppeNeu(t: TestContext, token: string, body: object) {
  return call(t, endpoints.EssensplanungGruppen, 'POST', 'planung/gruppen', { token, body });
}

function teilnehmendeNeu(t: TestContext, token: string, body: object) {
  return call(t, endpoints.EssensplanungTeilnehmendeListe, 'POST', 'planung/teilnehmende', {
    token,
    body,
  });
}

async function glutenId(): Promise<number> {
  return (
    await getDb()
      .selectFrom('essen.unvertraeglichkeit')
      .select('id')
      .where('schluessel', '=', 'gluten')
      .executeTakeFirstOrThrow()
  ).id;
}

dbTest('a Planung starts with the groups of the template, which can change', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  assert.deepEqual(
    ansicht.gruppen.map((g) => [g.position, g.name, g.faktor]),
    [
      [1, 'Wö', 0.7],
      [2, 'Jupfi', 0.8],
      [3, 'Pfadi', 1],
      [4, 'Rover', 1.2],
      [5, 'Leitende', 1.2],
    ]
  );
  const mitKueche = json<PlanungAnsicht>(
    await gruppeNeu(t, token, { name: 'Küche', faktor: '1,25' })
  );
  const kueche = mitKueche.gruppen.at(-1)!;
  assert.deepEqual([kueche.position, kueche.name, kueche.faktor], [6, 'Küche', 1.25]);
  assert.equal((await gruppeNeu(t, token, { name: 'küche', faktor: 1 })).status, 400);
  assert.equal((await gruppeNeu(t, token, { name: 'Gäste', faktor: 0 })).status, 400);
  assert.equal((await gruppeNeu(t, token, { name: 'Gäste', faktor: 5.001 })).status, 400);

  const geaendert = await call(
    t,
    endpoints.EssensplanungGruppe,
    'PATCH',
    `planung/gruppen/${kueche.id}`,
    {
      token,
      params: { id: String(kueche.id) },
      body: { etag: kueche.etag, name: 'Küchenteam', faktor: 1.5 },
    }
  );
  assert.equal(geaendert.status, 200);
  const alt = await call(
    t,
    endpoints.EssensplanungGruppe,
    'PATCH',
    `planung/gruppen/${kueche.id}`,
    {
      token,
      params: { id: String(kueche.id) },
      body: { etag: kueche.etag, name: 'Küche', faktor: 1 },
    }
  );
  assert.equal(alt.status, 409);

  // A group with participants stays; without them it goes
  const jetzt = json<PlanungAnsicht>(geaendert).gruppen.at(-1)!;
  await teilnehmendeNeu(t, token, { gruppeId: jetzt.id, ernaehrung: 'alles', anzahl: 3 });
  const loesche = (etag: string) =>
    call(t, endpoints.EssensplanungGruppe, 'DELETE', `planung/gruppen/${jetzt.id}`, {
      token,
      params: { id: String(jetzt.id) },
      ifMatch: etag,
    });
  assert.equal((await loesche(jetzt.etag)).status, 400);
  const leer = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  const zeile = leer.teilnehmende[0];
  await call(t, endpoints.EssensplanungTeilnehmende, 'DELETE', `planung/teilnehmende/${zeile.id}`, {
    token,
    params: { id: String(zeile.id) },
    ifMatch: zeile.etag,
  });
  assert.equal((await loesche(jetzt.etag)).status, 200);
});

dbTest('participants are counted per meal by group, diet and presence', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const [woe, , , rover, leitende] = ansicht.gruppen;
  const [tag1, tag2] = ansicht.tage;
  const gluten = await glutenId();

  assert.equal(
    (await teilnehmendeNeu(t, token, { gruppeId: woe.id, ernaehrung: 'alles', anzahl: 10 })).status,
    201
  );
  await teilnehmendeNeu(t, token, {
    gruppeId: woe.id,
    ernaehrung: 'vegetarisch',
    anzahl: 3,
    unvertraeglichkeiten: [gluten],
  });
  // Rover come for lunch on day 1 and leave after breakfast on day 2
  await teilnehmendeNeu(t, token, {
    gruppeId: rover.id,
    ernaehrung: 'vegan',
    anzahl: '2',
    vonMahlzeitId: tag1.mahlzeiten[1].id,
    bisMahlzeitId: tag2.mahlzeiten[0].id,
    hinweis: 'Zug um 9 Uhr',
  });
  const voll = json<PlanungAnsicht>(
    await teilnehmendeNeu(t, token, { gruppeId: leitende.id, ernaehrung: 'alles', anzahl: 4 })
  );
  assert.deepEqual(
    voll.teilnehmende.map((z) => [z.gruppeId, z.ernaehrung, z.anzahl, z.unvertraeglichkeiten]),
    [
      [woe.id, 'alles', 10, []],
      [woe.id, 'vegetarisch', 3, [gluten]],
      [rover.id, 'vegan', 2, []],
      [leitende.id, 'alles', 4, []],
    ]
  );

  // Wrong input
  const falsch = async (body: object, feld: string) => {
    const antwort = await teilnehmendeNeu(t, token, {
      gruppeId: woe.id,
      ernaehrung: 'alles',
      anzahl: 1,
      ...body,
    });
    assert.equal(antwort.status, 400, JSON.stringify(body));
    assert.ok(json<{ fields: Record<string, string> }>(antwort).fields[feld], feld);
  };
  await falsch({ anzahl: 0 }, 'anzahl');
  await falsch({ anzahl: 2.5 }, 'anzahl');
  await falsch({ ernaehrung: 'fleisch' }, 'ernaehrung');
  await falsch({ gruppeId: 999_999 }, 'gruppeId');
  await falsch({ unvertraeglichkeiten: [999_999] }, 'unvertraeglichkeiten');
  await falsch({ vonMahlzeitId: 999_999 }, 'vonMahlzeitId');
  await falsch(
    { vonMahlzeitId: tag2.mahlzeiten[0].id, bisMahlzeitId: tag1.mahlzeiten[0].id },
    'bisMahlzeitId'
  );

  // The first breakfast is for the leaders only
  for (const gruppe of voll.gruppen.filter((g) => g.id !== leitende.id)) {
    const antwort = await call(
      t,
      endpoints.EssensplanungMahlzeitGruppe,
      'PUT',
      `planung/mahlzeiten/${tag1.mahlzeiten[0].id}/gruppen`,
      {
        token,
        params: { id: String(tag1.mahlzeiten[0].id) },
        body: { gruppeId: gruppe.id, isst: false },
      }
    );
    assert.equal(antwort.status, 200);
  }
  const plan = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  assert.equal(plan.tage[0].mahlzeiten[0].ohneGruppen.length, 4);
  const esser = esserJeMahlzeit(plan);
  const bei = (tag: number, slot: number) => esser.get(plan.tage[tag].mahlzeiten[slot].id)!;
  // Breakfast day 1: 4 leaders × 1.2
  assert.deepEqual([bei(0, 0).personen, bei(0, 0).gewichtet], [4, 4.8]);
  // Lunch day 1: 13 Wö × 0.7 + 2 Rover × 1.2 + 4 leaders × 1.2
  assert.deepEqual([bei(0, 1).personen, bei(0, 1).gewichtet], [19, 16.3]);
  assert.deepEqual(bei(0, 1).je.vegan, { personen: 2, gewichtet: 2.4 });
  assert.deepEqual(bei(0, 1).je.vegetarisch, { personen: 3, gewichtet: 2.1 });
  // Breakfast day 2 with the Rover, lunch day 2 without
  assert.equal(bei(1, 0).personen, 19);
  assert.equal(bei(1, 1).personen, 17);

  // Back again: the leaders eat at the first breakfast with the others
  await call(
    t,
    endpoints.EssensplanungMahlzeitGruppe,
    'PUT',
    `planung/mahlzeiten/${tag1.mahlzeiten[0].id}/gruppen`,
    {
      token,
      params: { id: String(tag1.mahlzeiten[0].id) },
      body: { gruppeId: woe.id, isst: true },
    }
  );
  const zurueck = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  assert.equal(zurueck.tage[0].mahlzeiten[0].ohneGruppen.includes(woe.id), false);

  // A stale row is a conflict
  const rovers = zurueck.teilnehmende.find((z) => z.gruppeId === rover.id)!;
  const aendern = (etag: string, anzahl: number) =>
    call(t, endpoints.EssensplanungTeilnehmende, 'PATCH', `planung/teilnehmende/${rovers.id}`, {
      token,
      params: { id: String(rovers.id) },
      body: { ...rovers, etag, anzahl },
    });
  assert.equal((await aendern(rovers.etag, 3)).status, 200);
  assert.equal((await aendern(rovers.etag, 4)).status, 409);
});

dbTest('deleting a meal or day moves the limits of participants to the next one', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const [tag1, tag2, tag3] = ansicht.tage;
  const gruppe = ansicht.gruppen[0];
  await teilnehmendeNeu(t, token, {
    gruppeId: gruppe.id,
    ernaehrung: 'alles',
    anzahl: 5,
    vonMahlzeitId: tag1.mahlzeiten[2].id,
    bisMahlzeitId: tag2.mahlzeiten[2].id,
  });
  await teilnehmendeNeu(t, token, {
    gruppeId: gruppe.id,
    ernaehrung: 'vegan',
    anzahl: 1,
    vonMahlzeitId: tag2.mahlzeiten[0].id,
  });
  const vorher = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  // The start meal goes: from the next one
  const start = vorher.tage[0].mahlzeiten[2];
  await call(t, endpoints.EssensplanungMahlzeit, 'DELETE', `planung/mahlzeiten/${start.id}`, {
    token,
    params: { id: String(start.id) },
    ifMatch: mahlzeitStand(start),
  });
  // The whole day 2 goes: the end moves back to day 1, the other start forward to day 3
  const ohne = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  const zweiter = ohne.tage[1];
  const nachher = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungTag, 'DELETE', `planung/tage/${zweiter.id}`, {
      token,
      params: { id: String(zweiter.id) },
      ifMatch: tagStand(zweiter),
    })
  );
  const [erste, zweite] = nachher.teilnehmende;
  assert.equal(erste.vonMahlzeitId, tag1.mahlzeiten[3].id);
  assert.equal(erste.bisMahlzeitId, tag1.mahlzeiten.at(-1)!.id);
  assert.equal(zweite.vonMahlzeitId, tag3.mahlzeiten[0].id);

  // The whole Planung goes with groups, participants and skipped meals
  await call(
    t,
    endpoints.EssensplanungMahlzeitGruppe,
    'PUT',
    `planung/mahlzeiten/${tag3.mahlzeiten[0].id}/gruppen`,
    {
      token,
      params: { id: String(tag3.mahlzeiten[0].id) },
      body: { gruppeId: gruppe.id, isst: false },
    }
  );
  await planungLoeschen(await ladeZugang(token));
  const rest = await getDb()
    .selectFrom('essen.planung_gruppe')
    .select('id')
    .where('id', '=', gruppe.id)
    .executeTakeFirst();
  assert.equal(rest, undefined);
});

dbTest('the preview gets invented participants once', async () => {
  await seedPreviewEssensplanungPlanung();
  await seedPreviewEssensplanungTeilnehmende();
  await seedPreviewEssensplanungTeilnehmende();
  const zeilen = await getDb()
    .selectFrom('essen.teilnehmende as t')
    .innerJoin('essen.planung as p', 'p.id', 't.planung_id')
    .select('t.id')
    .where('p.name', '=', 'Sommerlager (Test)')
    .execute();
  assert.equal(zeilen.length, 4);
});
