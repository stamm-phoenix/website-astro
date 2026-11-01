import assert from 'node:assert/strict';
import * as endpoints from '../endpoints/essensplanung';
import * as einkauf from '../endpoints/essensplanung-einkauf';
import { EssensplanungZutatEinheiten } from '../endpoints/essensplanung-einheiten';
import { getDb } from '../lib/db';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

/** Units of one's own in the database, and bringing the units of an ingredient into line. */

dbTest('lines, extra needs and stock keep units of their own; all convert in one go', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const salz = (
    await getDb()
      .selectFrom('essen.zutat')
      .select('id')
      .where('name', '=', 'Salz')
      .executeTakeFirstOrThrow()
  ).id;
  const gericht = json<{ id: number }>(
    await call(t, endpoints.EssensplanungGerichte, 'POST', 'planung/gerichte', {
      token,
      body: { name: 'Kräuterquark', personen: 10 },
    })
  ).id;
  const zeile = await call(
    t,
    endpoints.EssensplanungGerichtZutaten,
    'POST',
    `planung/gerichte/${gericht}/zutaten`,
    {
      token,
      params: { id: String(gericht) },
      body: { zutatId: salz, menge: 3, einheit: 'Messerspitzen' },
    }
  );
  assert.equal(zeile.status, 201, JSON.stringify(zeile.jsonBody));
  const zusatz = await call(
    t,
    einkauf.EssensplanungZusatzbedarfListe,
    'POST',
    'planung/zusatzbedarf',
    {
      token,
      body: { zutatId: salz, menge: 200, einheit: 'g' },
    }
  );
  assert.equal(zusatz.status, 201, JSON.stringify(zusatz.jsonBody));
  const ansicht = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  const [linie] = ansicht.gerichte[0].zutaten;
  assert.equal(linie.einheit, 'Messerspitzen');
  const [extra] = ansicht.zusatzbedarf;
  const id = linie.planungZutatId;

  const senden = (zeilen: object[]) =>
    call(t, EssensplanungZutatEinheiten, 'PUT', `planung/zutaten/${id}/einheiten`, {
      token,
      params: { id: String(id) },
      body: { zeilen },
    });
  // A version seen before a change is a conflict, and nothing is saved
  const konflikt = await senden([
    { stelle: 'gericht', id: linie.id, etag: linie.etag, menge: 1.5, einheit: 'g' },
    { stelle: 'zusatzbedarf', id: extra.id, etag: 'AAAAAAAAAAE=', menge: 200, einheit: 'g' },
  ]);
  assert.equal(konflikt.status, 409, JSON.stringify(konflikt.jsonBody));
  const danach = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  assert.equal(danach.gerichte[0].zutaten[0].einheit, 'Messerspitzen');

  const ok = await senden([
    { stelle: 'gericht', id: linie.id, etag: linie.etag, menge: 1.5, einheit: 'g' },
  ]);
  assert.equal(ok.status, 200, JSON.stringify(ok.jsonBody));
  const neu = json<PlanungAnsicht>(ok);
  assert.deepEqual(
    [neu.gerichte[0].zutaten[0].menge, neu.gerichte[0].zutaten[0].einheit],
    [1.5, 'g']
  );
  assert.equal(neu.aenderungen[0].aktion, 'einheiten-vereinheitlicht');
});
