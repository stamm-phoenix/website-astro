import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import * as endpoints from '../endpoints/essensplanung';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

function teilnehmendeNeu(t: TestContext, token: string, body: object) {
  return call(t, endpoints.EssensplanungTeilnehmendeListe, 'POST', 'planung/teilnehmende', {
    token,
    body,
  });
}

dbTest('moving meals or days never lets participants end before they start', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const [tag1, tag2] = ansicht.tage;
  const [fruehstueck, mittag] = tag1.mahlzeiten;
  await teilnehmendeNeu(t, token, {
    gruppeId: ansicht.gruppen[2].id,
    ernaehrung: 'alles',
    anzahl: 4,
    vonMahlzeitId: fruehstueck.id,
    bisMahlzeitId: mittag.id,
  });
  await teilnehmendeNeu(t, token, {
    gruppeId: ansicht.gruppen[3].id,
    ernaehrung: 'vegan',
    anzahl: 2,
    vonMahlzeitId: tag1.mahlzeiten[3].id,
    bisMahlzeitId: tag2.mahlzeiten[0].id,
  });

  // Breakfast behind lunch: refused, nothing moves
  const mahlzeit = await call(
    t,
    endpoints.EssensplanungMahlzeit,
    'PATCH',
    `planung/mahlzeiten/${fruehstueck.id}`,
    {
      token,
      params: { id: String(fruehstueck.id) },
      body: { etag: fruehstueck.etag, name: fruehstueck.name, uhrzeit: null, position: 3 },
    }
  );
  assert.equal(mahlzeit.status, 400);
  assert.match(
    json<{ fields: Record<string, string> }>(mahlzeit).fields.anwesenheit,
    /^Dann wären 4 Pfadi erst nach ihrem Ende da\./
  );
  // The first day behind the second: refused too
  const tag = await call(t, endpoints.EssensplanungTag, 'PATCH', `planung/tage/${tag1.id}`, {
    token,
    params: { id: String(tag1.id) },
    body: { etag: tag1.etag, datum: '2027-09-01' },
  });
  assert.equal(tag.status, 400);
  assert.match(
    json<{ fields: Record<string, string> }>(tag).fields.anwesenheit,
    /^Dann wären 2 Rover erst nach ihrem Ende da\./
  );
  const jetzt = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  assert.equal(jetzt.tage[0].id, tag1.id);
  assert.equal(jetzt.tage[0].mahlzeiten[0].id, fruehstueck.id);

  // Moves that keep the order are fine: lunch stays after breakfast, day 2 moves on
  const spaeter = await call(t, endpoints.EssensplanungTag, 'PATCH', `planung/tage/${tag2.id}`, {
    token,
    params: { id: String(tag2.id) },
    body: { etag: tag2.etag, datum: '2027-09-01' },
  });
  assert.equal(spaeter.status, 200);
});
