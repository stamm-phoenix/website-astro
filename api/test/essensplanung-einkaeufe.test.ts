import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import * as einkauf from '../endpoints/essensplanung-einkauf';
import * as einkaeufe from '../endpoints/essensplanung-einkaeufe';
import * as endpoints from '../endpoints/essensplanung';
import { getDb } from '../lib/db';
import { listZutaten, updateZutat } from '../lib/essen-steuerung';
import type { ZutatInput } from '../lib/essen-validation';
import { ValidationError } from '../lib/validation/errors';
import { seedPreviewEssensplanungEinkauf } from '../lib/db-preview-essen-einkauf';
import { seedPreviewEssensplanungEinkaeufe } from '../lib/db-preview-essen-einkaeufe';
import {
  seedPreviewEssensplanung,
  seedPreviewEssensplanungGerichte,
  seedPreviewEssensplanungPlanung,
} from '../lib/db-preview';
import { einkaufStand } from '../lib/essen-einkaeufe-model';
import { ladeZugang, planungLoeschen } from '../lib/essen-planung';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

function senden(
  t: TestContext,
  endpoint: Parameters<typeof call>[1],
  method: string,
  path: string,
  token: string,
  { body, id, ifMatch }: { body?: object; id?: number; ifMatch?: string } = {}
) {
  return call(t, endpoint, method, path, {
    token,
    body,
    ...(id === undefined ? {} : { params: { id: String(id) } }),
    ...(ifMatch === undefined ? {} : { ifMatch }),
  });
}

/** A Planung with a shop and pasta in stock, so it has an ingredient. */
async function planung(t: TestContext) {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const nudeln = (
    await getDb()
      .selectFrom('essen.zutat')
      .select('id')
      .where('name', '=', 'Nudeln (Spaghetti)')
      .executeTakeFirstOrThrow()
  ).id;
  await senden(t, einkauf.EssensplanungGeschaefte, 'POST', 'planung/geschaefte', token, {
    body: { name: 'Metro' },
  });
  const mitBestand = json<PlanungAnsicht>(
    await senden(t, einkauf.EssensplanungBestandListe, 'POST', 'planung/bestand', token, {
      body: { zutatId: nudeln, menge: 1, einheit: 'kg', hinweis: '' },
    })
  );
  return {
    token,
    mahlzeit: ansicht.tage[0].mahlzeiten[1].id,
    geschaeft: mitBestand.geschaefte[0].id,
    zutat: mitBestand.zutaten.find((z) => z.zutatId === nudeln)!.id,
  };
}

dbTest('shopping trips are added, changed, finished and deleted', async (t) => {
  const { token, mahlzeit, geschaeft } = await planung(t);
  const neu = await senden(
    t,
    einkaeufe.EssensplanungEinkaeufe,
    'POST',
    'planung/einkaeufe',
    token,
    {
      body: {
        name: 'Metro Montag',
        datum: '2027-08-01',
        geschaeftId: geschaeft,
        bisMahlzeitId: mahlzeit,
      },
    }
  );
  assert.equal(neu.status, 201, JSON.stringify(neu.jsonBody));
  const [trip] = json<PlanungAnsicht>(neu).einkaeufe;
  assert.deepEqual(
    { ...trip, etag: '' },
    {
      id: trip.id,
      etag: '',
      position: 1,
      name: 'Metro Montag',
      datum: '2027-08-01',
      geschaeftId: geschaeft,
      bisMahlzeitId: mahlzeit,
      abgeschlossen: false,
      posten: [],
      regeln: [],
    }
  );
  assert.equal(json<PlanungAnsicht>(neu).aenderungen[0].aktion, 'einkauf-neu');

  // A meal or shop of another Planung is refused
  const fremd = await senden(
    t,
    einkaeufe.EssensplanungEinkaeufe,
    'POST',
    'planung/einkaeufe',
    token,
    {
      body: { name: 'X', bisMahlzeitId: 999_999 },
    }
  );
  assert.equal(fremd.status, 400);
  assert.ok(json<{ fields: Record<string, string> }>(fremd).fields.bisMahlzeitId);

  // Finished, on its version; the old one is a conflict
  const fertig = await senden(
    t,
    einkaeufe.EssensplanungEinkauf,
    'PATCH',
    'planung/einkaeufe',
    token,
    {
      id: trip.id,
      body: { ...trip, abgeschlossen: true },
    }
  );
  assert.equal(fertig.status, 200, JSON.stringify(fertig.jsonBody));
  const nachher = json<PlanungAnsicht>(fertig);
  assert.equal(nachher.einkaeufe[0].abgeschlossen, true);
  assert.equal(nachher.aenderungen[0].details.abgeschlossen, true);
  const alt = await senden(t, einkaeufe.EssensplanungEinkauf, 'PATCH', 'planung/einkaeufe', token, {
    id: trip.id,
    body: { ...trip, name: 'Alt' },
  });
  assert.equal(alt.status, 409);

  // Deleting the shop leaves the trip for every shop
  const ohneGeschaeft = json<PlanungAnsicht>(
    await senden(t, einkauf.EssensplanungGeschaeft, 'DELETE', 'planung/geschaefte', token, {
      id: geschaeft,
      ifMatch: nachher.geschaefte[0].etag,
    })
  );
  assert.equal(ohneGeschaeft.einkaeufe[0].geschaeftId, null);

  // Deleting with the version of the trip and what was ticked off on it
  const weg = await senden(
    t,
    einkaeufe.EssensplanungEinkauf,
    'DELETE',
    'planung/einkaeufe',
    token,
    {
      id: trip.id,
      ifMatch: einkaufStand(ohneGeschaeft.einkaeufe[0]),
    }
  );
  assert.equal(weg.status, 200, JSON.stringify(weg.jsonBody));
  assert.deepEqual(json<PlanungAnsicht>(weg).einkaeufe, []);
});

dbTest('things are ticked off with what was bought, also by two at once', async (t) => {
  const { token, zutat } = await planung(t);
  const id = json<PlanungAnsicht>(
    await senden(t, einkaeufe.EssensplanungEinkaeufe, 'POST', 'planung/einkaeufe', token, {
      body: { name: 'Montag' },
    })
  ).einkaeufe[0].id;
  const abhaken = (body: object) =>
    senden(t, einkaeufe.EssensplanungEinkaufAbhaken, 'PUT', 'planung/einkaeufe/posten', token, {
      id,
      body,
    });
  const erst = await abhaken({
    etag: null,
    planungZutatId: zutat,
    einheit: 'kg',
    erhalten: 0.8,
    ersatz: 'Vollkornnudeln',
  });
  assert.equal(erst.status, 200, JSON.stringify(erst.jsonBody));
  const ansicht = json<PlanungAnsicht>(erst);
  const [haken] = ansicht.einkaeufe[0].posten;
  assert.equal(haken.erhalten, 0.8);
  assert.equal(haken.einheit, 'kg');
  assert.equal(haken.ersatz, 'Vollkornnudeln');
  assert.equal(haken.von, 'Kim Küche');
  assert.equal(ansicht.aenderungen[0].aktion, 'einkauf-abgehakt');
  assert.equal(ansicht.zutaten.find((z) => z.id === zutat)!.zeilen, 2);

  // Someone else ticked it off meanwhile (no version given): conflict; also in g, the same kind
  const doppelt = await abhaken({ etag: null, planungZutatId: zutat, einheit: 'g', erhalten: 1 });
  assert.equal(doppelt.status, 409);
  // A unit that does not fit is refused
  const falsch = await abhaken({
    etag: null,
    planungZutatId: zutat,
    einheit: 'stueck',
    erhalten: 1,
  });
  assert.equal(falsch.status, 400);
  // Changed on its version, in another unit of the same kind
  const geaendert = await abhaken({
    etag: haken.etag,
    planungZutatId: zutat,
    einheit: 'g',
    erhalten: 900,
    ersatz: '',
  });
  assert.equal(geaendert.status, 200, JSON.stringify(geaendert.jsonBody));
  const neu = json<PlanungAnsicht>(geaendert).einkaeufe[0].posten;
  assert.equal(neu.length, 1);
  assert.equal(neu[0].erhalten, 900);
  assert.equal(neu[0].einheit, 'g');

  // An ingredient with something ticked off cannot be deleted
  const zutatEtag = json<PlanungAnsicht>(geaendert).zutaten.find((z) => z.id === zutat)!.etag;
  const bestand = json<PlanungAnsicht>(geaendert).bestand[0];
  await senden(t, einkauf.EssensplanungBestand, 'DELETE', 'planung/bestand', token, {
    id: bestand.id,
    ifMatch: bestand.etag,
  });
  const zutatLoeschen = await senden(
    t,
    endpoints.EssensplanungZutat,
    'DELETE',
    'planung/zutaten',
    token,
    {
      id: zutat,
      ifMatch: zutatEtag,
    }
  );
  assert.equal(zutatLoeschen.status, 400, JSON.stringify(zutatLoeschen.jsonBody));

  // Taken back on its version
  const alt = await senden(
    t,
    einkaeufe.EssensplanungEinkaufPosten,
    'DELETE',
    'planung/einkauf-posten',
    token,
    {
      id: neu[0].id,
      ifMatch: haken.etag,
    }
  );
  assert.equal(alt.status, 409);
  const auf = await senden(
    t,
    einkaeufe.EssensplanungEinkaufPosten,
    'DELETE',
    'planung/einkauf-posten',
    token,
    {
      id: neu[0].id,
      ifMatch: neu[0].etag,
    }
  );
  assert.equal(auf.status, 200, JSON.stringify(auf.jsonBody));
  assert.deepEqual(json<PlanungAnsicht>(auf).einkaeufe[0].posten, []);

  // The read-only link sees it, but cannot tick off
  const lesen = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungLinks, 'POST', 'planung/links', {
      token,
      body: { art: 'lesen', an: true },
    })
  ).links!.lesen!;
  const gelesen = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token: lesen })
  );
  assert.equal(gelesen.einkaeufe.length, 1);
  const verboten = await call(
    t,
    einkaeufe.EssensplanungEinkaufAbhaken,
    'PUT',
    'planung/einkaeufe/posten',
    {
      token: lesen,
      params: { id: String(id) },
      body: { etag: null, planungZutatId: zutat, einheit: 'kg', erhalten: 1 },
    }
  );
  assert.equal(verboten.status, 403);
});

dbTest('rules and moves between trips; deleting the Planung takes it all', async (t) => {
  const { token, zutat } = await planung(t);
  await senden(t, einkaeufe.EssensplanungEinkaeufe, 'POST', 'planung/einkaeufe', token, {
    body: { name: 'Montag' },
  });
  const [a, b] = json<PlanungAnsicht>(
    await senden(t, einkaeufe.EssensplanungEinkaeufe, 'POST', 'planung/einkaeufe', token, {
      body: { name: 'Mittwoch' },
    })
  ).einkaeufe;
  const regel = (id: number, body: object) =>
    senden(t, einkaeufe.EssensplanungEinkaufRegel, 'PUT', 'planung/einkaeufe/regeln', token, {
      id,
      body: { planungZutatId: zutat, ...body },
    });
  const fest = await regel(a.id, { art: 'fest', menge: 1.5, einheit: 'kg' });
  assert.equal(fest.status, 200, JSON.stringify(fest.jsonBody));
  assert.deepEqual(json<PlanungAnsicht>(fest).einkaeufe[0].regeln, [
    { planungZutatId: zutat, art: 'fest', menge: 1.5, einheit: 'kg' },
  ]);
  const ohneEinheit = await regel(a.id, { art: 'fest', menge: 1 });
  assert.equal(ohneEinheit.status, 400);

  // Moving replaces the rule here and sets one there, in one change
  const verschoben = await senden(
    t,
    einkaeufe.EssensplanungEinkaufVerschieben,
    'POST',
    'planung/einkaeufe/verschieben',
    token,
    { id: a.id, body: { planungZutatId: zutat, nachEinkaufId: b.id } }
  );
  assert.equal(verschoben.status, 200, JSON.stringify(verschoben.jsonBody));
  const nachher = json<PlanungAnsicht>(verschoben);
  assert.deepEqual(
    nachher.einkaeufe.map((e) => e.regeln.map((r) => r.art)),
    [['ohne'], ['mit']]
  );
  assert.equal(nachher.aenderungen[0].aktion, 'einkauf-verschoben');
  const selbst = await senden(
    t,
    einkaeufe.EssensplanungEinkaufVerschieben,
    'POST',
    'planung/einkaeufe/verschieben',
    token,
    { id: a.id, body: { planungZutatId: zutat, nachEinkaufId: a.id } }
  );
  assert.equal(selbst.status, 400);

  // Taking a rule away
  const weg = json<PlanungAnsicht>(await regel(a.id, { art: null }));
  assert.deepEqual(weg.einkaeufe[0].regeln, []);

  // A Planung with trips, ticked off things and rules is deleted as a whole
  await senden(t, einkaeufe.EssensplanungEinkaufAbhaken, 'PUT', 'planung/einkaeufe/posten', token, {
    id: b.id,
    body: { etag: null, planungZutatId: zutat, einheit: 'kg', erhalten: 1 },
  });
  const zugang = await ladeZugang(token);
  await planungLoeschen(zugang);
  const rest = await getDb()
    .selectFrom('essen.einkauf')
    .select('id')
    .where('planung_id', '=', zugang.planungId)
    .execute();
  assert.deepEqual(rest, []);
});

dbTest('the preview gets invented shopping trips once', async () => {
  await seedPreviewEssensplanung();
  await seedPreviewEssensplanungPlanung();
  await seedPreviewEssensplanungGerichte();
  await seedPreviewEssensplanungEinkauf();
  await seedPreviewEssensplanungEinkaeufe();
  await seedPreviewEssensplanungEinkaeufe();
  const planung = await getDb()
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .executeTakeFirstOrThrow();
  const trips = await getDb()
    .selectFrom('essen.einkauf')
    .select('id')
    .where('planung_id', '=', planung.id)
    .execute();
  assert.equal(trips.length, 2);
  const ids = trips.map((trip) => trip.id);
  const posten = await getDb()
    .selectFrom('essen.einkauf_posten')
    .select('id')
    .where('einkauf_id', 'in', ids)
    .execute();
  const regeln = await getDb()
    .selectFrom('essen.einkauf_regel')
    .select('id')
    .where('einkauf_id', 'in', ids)
    .execute();
  assert.equal(posten.length, 1);
  assert.equal(regeln.length, 2);
});

dbTest('the Steuerung keeps the kind of unit of an ingredient ticked off on a trip', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const zentral = (await listZutaten()).find((z) => z.name === 'Zimt')!;
  // Only in a dish without an amount, so nothing else measures it
  const gericht = json<{ id: number }>(
    await senden(t, endpoints.EssensplanungGerichte, 'POST', 'planung/gerichte', token, {
      body: { name: 'Milchreis', personen: 10 },
    })
  ).id;
  const zeile = await senden(
    t,
    endpoints.EssensplanungGerichtZutaten,
    'POST',
    'planung/gerichte/zutaten',
    token,
    { id: gericht, body: { zutatId: zentral.id } }
  );
  assert.equal(zeile.status, 201, JSON.stringify(zeile.jsonBody));
  const mitZeile = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  const zutat = mitZeile.zutaten.find((z) => z.zutatId === zentral.id)!.id;
  const id = json<PlanungAnsicht>(
    await senden(t, einkaeufe.EssensplanungEinkaeufe, 'POST', 'planung/einkaeufe', token, {
      body: { name: 'Montag' },
    })
  ).einkaeufe[0].id;
  const haken = await senden(
    t,
    einkaeufe.EssensplanungEinkaufAbhaken,
    'PUT',
    'planung/einkaeufe/posten',
    token,
    {
      id,
      body: { etag: null, planungZutatId: zutat, einheit: 'g', erhalten: 50 },
    }
  );
  assert.equal(haken.status, 200, JSON.stringify(haken.jsonBody));
  const input = Object.fromEntries(
    Object.entries(zentral).filter(
      ([key]) => !['id', 'etag', 'geaendertAm', 'geaendertVon'].includes(key)
    )
  ) as unknown as ZutatInput;
  await assert.rejects(
    updateZutat(String(zentral.id), { ...input, einheitenart: 'stueck' }, zentral.etag, 'test'),
    (error: unknown) => error instanceof ValidationError && error.fields.einheitenart !== undefined
  );
});

dbTest('taking back undoes a move in one change, or changes nothing', async (t) => {
  const { token, zutat } = await planung(t);
  await senden(t, einkaeufe.EssensplanungEinkaeufe, 'POST', 'planung/einkaeufe', token, {
    body: { name: 'Montag' },
  });
  const [a, b] = json<PlanungAnsicht>(
    await senden(t, einkaeufe.EssensplanungEinkaeufe, 'POST', 'planung/einkaeufe', token, {
      body: { name: 'Mittwoch' },
    })
  ).einkaeufe;
  const zurueck = (id: number, body: object) =>
    senden(
      t,
      einkaeufe.EssensplanungEinkaufZurueckholen,
      'POST',
      'planung/einkaeufe/zurueckholen',
      token,
      {
        id,
        body,
      }
    );
  await senden(
    t,
    einkaeufe.EssensplanungEinkaufVerschieben,
    'POST',
    'planung/einkaeufe/verschieben',
    token,
    {
      id: a.id,
      body: { planungZutatId: zutat, nachEinkaufId: b.id },
    }
  );
  const regeln = async () =>
    (
      await getDb()
        .selectFrom('essen.einkauf_regel')
        .select(['einkauf_id', 'art'])
        .where('planung_zutat_id', '=', zutat)
        .orderBy('einkauf_id')
        .execute()
    ).map((r) => `${r.einkauf_id}:${r.art}`);
  const vorher = await regeln();
  assert.deepEqual(vorher, [`${a.id}:ohne`, `${b.id}:mit`]);

  // Not taken off on the target: refused, nothing changes
  const falsch = await zurueck(b.id, { planungZutatId: zutat });
  assert.equal(falsch.status, 400, JSON.stringify(falsch.jsonBody));
  assert.deepEqual(await regeln(), vorher);
  const kaputt = await zurueck(a.id, { planungZutatId: 'x' });
  assert.equal(kaputt.status, 400);
  assert.deepEqual(await regeln(), vorher);

  // Taken back: both rules go in one change
  const ok = await zurueck(a.id, { planungZutatId: zutat });
  assert.equal(ok.status, 200, JSON.stringify(ok.jsonBody));
  const ansicht = json<PlanungAnsicht>(ok);
  assert.deepEqual(await regeln(), []);
  assert.deepEqual(
    ansicht.einkaeufe.map((e) => e.regeln),
    [[], []]
  );
  assert.equal(ansicht.aenderungen[0].aktion, 'einkauf-zurueckgeholt');
});
