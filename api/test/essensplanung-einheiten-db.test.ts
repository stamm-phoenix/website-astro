import assert from 'node:assert/strict';
import * as endpoints from '../endpoints/essensplanung';
import * as einkauf from '../endpoints/essensplanung-einkauf';
import * as einkaeufe from '../endpoints/essensplanung-einkaeufe';
import * as kochen from '../endpoints/essensplanung-kochen';
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
    {
      stelle: 'gericht',
      id: linie.id,
      etag: linie.etag,
      menge: 1.5,
      einheit: 'g',
      von: 'Messerspitzen',
    },
    {
      stelle: 'zusatzbedarf',
      id: extra.id,
      etag: 'AAAAAAAAAAE=',
      menge: 200,
      einheit: 'g',
      von: 'g',
    },
  ]);
  assert.equal(konflikt.status, 409, JSON.stringify(konflikt.jsonBody));
  const danach = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  assert.equal(danach.gerichte[0].zutaten[0].einheit, 'Messerspitzen');

  const ok = await senden([
    {
      stelle: 'gericht',
      id: linie.id,
      etag: linie.etag,
      menge: 1.5,
      einheit: 'g',
      von: 'Messerspitzen',
    },
  ]);
  assert.equal(ok.status, 200, JSON.stringify(ok.jsonBody));
  const neu = json<PlanungAnsicht>(ok);
  assert.deepEqual(
    [neu.gerichte[0].zutaten[0].menge, neu.gerichte[0].zutaten[0].einheit],
    [1.5, 'g']
  );
  assert.equal(neu.aenderungen[0].aktion, 'einheiten-vereinheitlicht');
});

dbTest(
  'what was cooked and bought converts with the needs, so the stock stays right',
  async (t) => {
    const mails = captureMails(t);
    const { token, ansicht } = await anlegen(t, mails);
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
    await call(
      t,
      endpoints.EssensplanungGerichtZutaten,
      'POST',
      `planung/gerichte/${gericht}/zutaten`,
      {
        token,
        params: { id: String(gericht) },
        body: { zutatId: salz, menge: 1, einheit: 'Bund' },
      }
    );
    await call(t, endpoints.EssensplanungEinplanungen, 'POST', 'planung/einplanungen', {
      token,
      body: { mahlzeitId: ansicht.tage[0].mahlzeiten[1].id, gerichtId: gericht },
    });
    let stand = json<PlanungAnsicht>(
      await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
    );
    const id = stand.gerichte[0].zutaten[0].planungZutatId;
    const geplant = stand.tage[0].mahlzeiten[1].einplanungen[0];
    // Cooked with 40 g and 1 Bund; on a trip 100 g and 2 Bund were bought
    const gekocht = await call(
      t,
      kochen.EssensplanungEinplanungStatus,
      'PUT',
      `planung/einplanungen/${geplant.id}/status`,
      {
        token,
        params: { id: String(geplant.id) },
        body: {
          etag: geplant.etag,
          status: 'gekocht',
          verbrauch: [
            { planungZutatId: id, menge: 40, einheit: 'g' },
            { planungZutatId: id, menge: 1, einheit: 'bund' },
          ],
        },
      }
    );
    assert.equal(gekocht.status, 200, JSON.stringify(gekocht.jsonBody));
    const einkaufId = json<PlanungAnsicht>(
      await call(t, einkaeufe.EssensplanungEinkaeufe, 'POST', 'planung/einkaeufe', {
        token,
        body: { name: 'Montag' },
      })
    ).einkaeufe[0].id;
    for (const [einheit, erhalten, ersatz] of [
      ['g', 100, ''],
      ['bund', 2, 'glatt'],
    ] as const) {
      const haken = await call(
        t,
        einkaeufe.EssensplanungEinkaufAbhaken,
        'PUT',
        'planung/einkaeufe/posten',
        {
          token,
          params: { id: String(einkaufId) },
          body: { etag: null, planungZutatId: id, einheit, erhalten, ersatz },
        }
      );
      assert.equal(haken.status, 200, JSON.stringify(haken.jsonBody));
      stand = json<PlanungAnsicht>(haken);
    }
    const einplanung = stand.tage[0].mahlzeiten[1].einplanungen[0];
    const inGramm = stand.einkaeufe[0].posten.find((p) => p.einheit === 'g')!;

    const senden = (zeilen: object[]) =>
      call(t, EssensplanungZutatEinheiten, 'PUT', `planung/zutaten/${id}/einheiten`, {
        token,
        params: { id: String(id) },
        body: { zeilen },
      });
    // An old version of the cooked dish is a conflict, and nothing is saved
    const alt = await senden([
      {
        stelle: 'verbrauch',
        id: einplanung.id,
        etag: geplant.etag,
        menge: 2,
        einheit: 'bund',
        von: 'g',
      },
    ]);
    assert.equal(alt.status, 409, JSON.stringify(alt.jsonBody));

    // 20 g are one Bund: the entries in Bund are added up, nothing is lost
    const ok = await senden([
      {
        stelle: 'verbrauch',
        id: einplanung.id,
        etag: einplanung.etag,
        menge: 2,
        einheit: 'bund',
        von: 'g',
      },
      {
        stelle: 'erhalten',
        id: inGramm.id,
        etag: inGramm.etag,
        menge: 5,
        einheit: 'bund',
        von: 'g',
      },
    ]);
    assert.equal(ok.status, 200, JSON.stringify(ok.jsonBody));
    const neu = json<PlanungAnsicht>(ok);
    assert.deepEqual(
      neu.tage[0].mahlzeiten[1].einplanungen[0].verbrauch.map((v) => [v.menge, v.einheit]),
      [[3, 'bund']]
    );
    assert.notEqual(neu.tage[0].mahlzeiten[1].einplanungen[0].etag, einplanung.etag);
    assert.deepEqual(
      neu.einkaeufe[0].posten.map((p) => [p.erhalten, p.einheit, p.ersatz]),
      [[7, 'bund', 'glatt']]
    );
    // When it was ticked off stays (the newer of the two ticks), only the version is new
    const [zusammen] = neu.einkaeufe[0].posten;
    const staende = stand.einkaeufe[0].posten.map((p) => p.stand!).sort();
    assert.equal(zusammen.stand, staende.at(-1));
    assert.notEqual(zusammen.stand, zusammen.etag);
  }
);

dbTest(
  'a need without an amount put on the list after a tick stays after converting',
  async (t) => {
    const mails = captureMails(t);
    const { token } = await anlegen(t, mails);
    const petersilie = (
      await getDb()
        .selectFrom('essen.zutat')
        .select('id')
        .where('name', '=', 'TK-Petersilie')
        .executeTakeFirstOrThrow()
    ).id;
    // 20 g needed and bought
    let ansicht = json<PlanungAnsicht>(
      await call(t, einkauf.EssensplanungZusatzbedarfListe, 'POST', 'planung/zusatzbedarf', {
        token,
        body: { zutatId: petersilie, menge: 20, einheit: 'g' },
      })
    );
    const id = ansicht.zusatzbedarf[0].planungZutatId;
    const einkaufId = json<PlanungAnsicht>(
      await call(t, einkaeufe.EssensplanungEinkaeufe, 'POST', 'planung/einkaeufe', {
        token,
        body: { name: 'Montag' },
      })
    ).einkaeufe[0].id;
    await call(t, einkaeufe.EssensplanungEinkaufAbhaken, 'PUT', 'planung/einkaeufe/posten', {
      token,
      params: { id: String(einkaufId) },
      body: { etag: null, planungZutatId: id, einheit: 'g', erhalten: 20, ersatz: '' },
    });
    // Then put on the list again without an amount
    ansicht = json<PlanungAnsicht>(
      await call(t, einkauf.EssensplanungZusatzbedarfListe, 'POST', 'planung/zusatzbedarf', {
        token,
        body: { zutatId: petersilie, menge: null, einheit: null },
      })
    );
    const ohneMenge = ansicht.zusatzbedarf.find((p) => p.menge === null)!;
    const [haken] = ansicht.einkaeufe[0].posten;
    assert.ok(haken.stand! < ohneMenge.etag);

    const ok = await call(
      t,
      EssensplanungZutatEinheiten,
      'PUT',
      `planung/zutaten/${id}/einheiten`,
      {
        token,
        params: { id: String(id) },
        body: {
          zeilen: [
            {
              stelle: 'erhalten',
              id: haken.id,
              etag: haken.etag,
              menge: 1,
              einheit: 'bund',
              von: 'g',
            },
          ],
        },
      }
    );
    assert.equal(ok.status, 200, JSON.stringify(ok.jsonBody));
    const [neu] = json<PlanungAnsicht>(ok).einkaeufe[0].posten;
    // A new version, but still ticked off before the need: the need stays on the list
    assert.ok(neu.etag > ohneMenge.etag);
    assert.equal(neu.stand, haken.stand);
  }
);
