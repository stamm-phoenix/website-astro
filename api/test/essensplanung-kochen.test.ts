import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import * as einkauf from '../endpoints/essensplanung-einkauf';
import * as endpoints from '../endpoints/essensplanung';
import * as kochen from '../endpoints/essensplanung-kochen';
import { getDb } from '../lib/db';
import { gerichtStand } from '../lib/essen-gerichte-model';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

function abhaken(t: TestContext, token: string, id: number, body: object) {
  return call(t, kochen.EssensplanungEinplanungStatus, 'PUT', `planung/einplanungen/${id}/status`, {
    token,
    params: { id: String(id) },
    body,
  });
}

dbTest('planned dishes are ticked off as cooked with what they used, or left out', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const gericht = json<{ id: number }>(
    await call(t, endpoints.EssensplanungGerichte, 'POST', 'planung/gerichte', {
      token,
      body: { name: 'Nudeln', personen: 10 },
    })
  ).id;
  const mittag = ansicht.tage[0].mahlzeiten[1];
  await call(t, endpoints.EssensplanungEinplanungen, 'POST', 'planung/einplanungen', {
    token,
    body: { mahlzeitId: mittag.id, gerichtId: gericht },
  });
  // An ingredient of the Planung, through the stock
  const salz = (
    await getDb()
      .selectFrom('essen.zutat')
      .select('id')
      .where('name', '=', 'Salz')
      .executeTakeFirstOrThrow()
  ).id;
  const mitBestand = json<PlanungAnsicht>(
    await call(t, einkauf.EssensplanungBestandListe, 'POST', 'planung/bestand', {
      token,
      body: { zutatId: salz, menge: 1, einheit: 'kg', hinweis: '' },
    })
  );
  const zutat = mitBestand.zutaten.find((z) => z.zutatId === salz)!;
  const geplant = mitBestand.tage[0].mahlzeiten[1].einplanungen[0];
  assert.equal(geplant.status, 'offen');
  assert.deepEqual(geplant.verbrauch, []);

  // Cooked: what it used is kept, also 0 for not used
  const gekocht = json<PlanungAnsicht>(
    await abhaken(t, token, geplant.id, {
      etag: geplant.etag,
      status: 'gekocht',
      verbrauch: [{ planungZutatId: zutat.id, menge: 0.2, einheit: 'kg' }],
    })
  );
  const nachher = gekocht.tage[0].mahlzeiten[1].einplanungen[0];
  assert.equal(nachher.status, 'gekocht');
  assert.deepEqual(nachher.verbrauch, [{ planungZutatId: zutat.id, menge: 0.2, einheit: 'kg' }]);
  assert.equal(gekocht.aenderungen[0].aktion, 'einplanung-abgehakt');
  assert.equal(gekocht.aenderungen[0].details.status, 'gekocht');

  // A stale version is a conflict; an ingredient of another Planung is refused
  const alt = await abhaken(t, token, geplant.id, { etag: geplant.etag, status: 'ausgelassen' });
  assert.equal(alt.status, 409);
  const andere = await anlegen(t, mails);
  const fremd = json<PlanungAnsicht>(
    await call(t, einkauf.EssensplanungBestandListe, 'POST', 'planung/bestand', {
      token: andere.token,
      body: { zutatId: salz, menge: 1, einheit: 'kg', hinweis: '' },
    })
  ).zutaten[0];
  const falsch = await abhaken(t, token, geplant.id, {
    etag: nachher.etag,
    status: 'gekocht',
    verbrauch: [{ planungZutatId: fremd.id, menge: 1, einheit: 'kg' }],
  });
  assert.equal(falsch.status, 400);
  // Salt is measured by weight; pieces would leave the kilogram in stock untouched
  const stueck = await abhaken(t, token, geplant.id, {
    etag: nachher.etag,
    status: 'gekocht',
    verbrauch: [{ planungZutatId: zutat.id, menge: 1, einheit: 'stueck' }],
  });
  assert.equal(stueck.status, 400);
  assert.match(json<{ fields: Record<string, string> }>(stueck).fields.verbrauch, /Salz/);
  const unveraendert = await getDb()
    .selectFrom('essen.einplanung_verbrauch')
    .select(['menge', 'einheit'])
    .where('einplanung_id', '=', geplant.id)
    .execute();
  assert.deepEqual(
    unveraendert.map((v) => ({ menge: Number(v.menge), einheit: v.einheit })),
    [{ menge: 0.2, einheit: 'kg' }]
  );

  // Left out: nothing used any more
  const ausgelassen = json<PlanungAnsicht>(
    await abhaken(t, token, geplant.id, {
      etag: nachher.etag,
      status: 'ausgelassen',
      verbrauch: [{ planungZutatId: zutat.id, menge: 1, einheit: 'kg' }],
    })
  );
  const zuletzt = ausgelassen.tage[0].mahlzeiten[1].einplanungen[0];
  assert.equal(zuletzt.status, 'ausgelassen');
  assert.deepEqual(zuletzt.verbrauch, []);

  // An ingredient used by a cooked dish cannot be deleted; deleting the dish takes it all away
  await abhaken(t, token, geplant.id, {
    etag: zuletzt.etag,
    status: 'gekocht',
    verbrauch: [{ planungZutatId: zutat.id, menge: 0.1, einheit: 'kg' }],
  });
  const verbraucht = await getDb()
    .selectFrom('essen.einplanung_verbrauch')
    .select('id')
    .where('einplanung_id', '=', geplant.id)
    .execute();
  assert.equal(verbraucht.length, 1);
  // What was cooked measures the ingredient too, also without stock
  await getDb().deleteFrom('essen.bestand').where('planung_zutat_id', '=', zutat.id).execute();
  const ohneBestand = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  ).zutaten.find((z) => z.id === zutat.id)!;
  const art = await call(t, endpoints.EssensplanungZutat, 'PATCH', `planung/zutaten/${zutat.id}`, {
    token,
    params: { id: String(zutat.id) },
    body: { etag: ohneBestand.etag, kategorieId: null, einheitenart: 'stueck' },
  });
  assert.equal(art.status, 400);
  assert.match(
    json<{ fields: Record<string, string> }>(art).fields.einheitenart,
    /abgehakter Verbrauch/
  );
  const stand = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  const zuLoeschen = stand.gerichte.find((g) => g.id === gericht)!;
  const geloescht = await call(
    t,
    endpoints.EssensplanungGericht,
    'DELETE',
    `planung/gerichte/${gericht}`,
    {
      token,
      params: { id: String(gericht) },
      // The dish with its planned places, as the page sends it
      ifMatch: gerichtStand(
        zuLoeschen,
        stand.tage.flatMap((tag) =>
          tag.mahlzeiten.flatMap((m) =>
            m.einplanungen.filter((e) => e.gerichtId === gericht).map((e) => e.etag)
          )
        )
      ),
    }
  );
  assert.equal(geloescht.status, 200, JSON.stringify(geloescht.jsonBody));
  assert.equal(
    (
      await getDb()
        .selectFrom('essen.einplanung_verbrauch')
        .select('id')
        .where('einplanung_id', '=', geplant.id)
        .execute()
    ).length,
    0
  );
});

dbTest('two Planungen tick off the same central ingredients at once', async (t) => {
  const mails = captureMails(t);
  const zentral = async (name: string) =>
    (
      await getDb()
        .selectFrom('essen.zutat')
        .select('id')
        .where('name', '=', name)
        .executeTakeFirstOrThrow()
    ).id;
  const salz = await zentral('Salz');
  const pfeffer = await zentral('Pfeffer');

  /** A Planung with a planned dish that took the two ingredients over in the given order. */
  async function planung(reihenfolge: number[]) {
    const { token, ansicht } = await anlegen(t, mails);
    const gericht = json<{ id: number }>(
      await call(t, endpoints.EssensplanungGerichte, 'POST', 'planung/gerichte', {
        token,
        body: { name: 'Suppe', personen: 10 },
      })
    ).id;
    await call(t, endpoints.EssensplanungEinplanungen, 'POST', 'planung/einplanungen', {
      token,
      body: { mahlzeitId: ansicht.tage[0].mahlzeiten[1].id, gerichtId: gericht },
    });
    let stand: PlanungAnsicht | undefined;
    for (const zutatId of reihenfolge) {
      stand = json<PlanungAnsicht>(
        await call(t, einkauf.EssensplanungBestandListe, 'POST', 'planung/bestand', {
          token,
          body: { zutatId, menge: 1, einheit: 'kg', hinweis: '' },
        })
      );
    }
    const einplanung = stand!.tage[0].mahlzeiten[1].einplanungen[0];
    const verbrauch = stand!.zutaten.map((z) => ({
      planungZutatId: z.id,
      menge: 0.1,
      einheit: 'kg',
    }));
    return { token, einplanung, verbrauch };
  }
  const a = await planung([salz, pfeffer]);
  const b = await planung([pfeffer, salz]);
  for (let runde = 0; runde < 3; runde++) {
    const status = runde % 2 ? 'ausgelassen' : 'gekocht';
    const [ra, rb] = await Promise.all(
      [a, b].map((p) =>
        abhaken(t, p.token, p.einplanung.id, {
          etag: p.einplanung.etag,
          status,
          verbrauch: p.verbrauch,
        })
      )
    );
    for (const [p, r] of [
      [a, ra],
      [b, rb],
    ] as const) {
      assert.equal(r.status, 200, JSON.stringify(r.jsonBody));
      p.einplanung = json<PlanungAnsicht>(r).tage[0].mahlzeiten[1].einplanungen[0];
    }
  }
});
