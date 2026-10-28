import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import type { HttpResponseInit } from '@azure/functions';
import * as endpoints from '../endpoints/essensplanung';
import {
  EssensplanungListeEintrag,
  EssensplanungSteuerung,
} from '../endpoints/intern-essensplanung-steuerung';
import { CONFIG } from '../lib/config';
import { getDb } from '../lib/db';
import { seedPreviewEssensplanungPlanung } from '../lib/db-preview';
import { raeumeAuf } from '../lib/essen-aufbewahrung';
import { essenMail } from '../lib/essen-mails';
import { PlanungError, einladen, ladeZugang, planungLoeschen } from '../lib/essen-planung';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { loeschDatum } from '../lib/essen-planung-model';
import type { EssenSteuerungView } from '../lib/essen-validation';
import { solvedAltcha, useAltcha } from './fixtures/altcha';
import { overrideConfig } from './fixtures/config';
import { dbTest } from './fixtures/database';

type Endpoint = (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>;

interface Optionen {
  token?: string;
  body?: unknown;
  params?: Record<string, string>;
  ifMatch?: string;
  query?: string;
}

function context(t: TestContext): InvocationContext {
  const result = new InvocationContext();
  t.mock.method(result, 'log', () => undefined);
  t.mock.method(result, 'error', () => undefined);
  return result;
}

function call(
  t: TestContext,
  endpoint: Endpoint,
  method: string,
  path: string,
  { token, body, params, ifMatch, query = '' }: Optionen = {}
): Promise<HttpResponseInit> {
  return endpoint(
    new HttpRequest({
      url: `https://www.stamm-phoenix.de/api/essensplanung/${path}${query}`,
      method,
      headers: {
        ...(token ? { 'x-essensplanung-token': token } : {}),
        ...(ifMatch ? { 'if-match': ifMatch } : {}),
      },
      params,
      body: body === undefined ? undefined : { string: JSON.stringify(body) },
    }),
    context(t)
  );
}

function json<T = Record<string, unknown>>(response: HttpResponseInit): T {
  return response.jsonBody as T;
}

interface GesendeteMail {
  to: string;
  subject: string;
  html: string;
}

function captureMails(t: TestContext): GesendeteMail[] {
  const mails: GesendeteMail[] = [];
  t.mock.method(essenMail, 'send', async (to: string, subject: string, html: string) => {
    mails.push({ to, subject, html });
  });
  return mails;
}

/** The token of the first link with `#<param>=` in a mail. */
function tokenAus(mail: GesendeteMail, param: string): string {
  const match = new RegExp(`#${param}=([A-Za-z0-9_-]{43})`).exec(mail.html);
  assert.ok(match, `no #${param}= link in the mail`);
  return match[1];
}

let naechste = 0;
let BESITZERIN = { email: 'kueche@stamm-phoenix.de', name: 'Kim Küche' };

/** A new owner address per Planung, so the limit of requests per address never interferes. */
function neueBesitzerin(): void {
  BESITZERIN = { email: `kueche${++naechste}@stamm-phoenix.de`, name: 'Kim Küche' };
}

/** Creates and confirms a Planung of three days; returns the owner's token and the view. */
async function anlegen(
  t: TestContext,
  mails: GesendeteMail[]
): Promise<{ token: string; ansicht: PlanungAnsicht }> {
  useAltcha(t);
  neueBesitzerin();
  const angelegt = await call(t, endpoints.EssensplanungAnlegen, 'POST', 'anlegen', {
    body: {
      ...BESITZERIN,
      planungName: 'Sommerlager',
      ersterTag: '2027-08-01',
      letzterTag: '2027-08-03',
      altcha: await solvedAltcha(),
    },
  });
  assert.equal(angelegt.status, 200, JSON.stringify(angelegt.jsonBody));
  const mail = mails.at(-1)!;
  assert.equal(mail.to, BESITZERIN.email);
  const bestaetigt = await call(
    t,
    endpoints.EssensplanungBestaetigen,
    'POST',
    'anlegen/bestaetigen',
    {
      body: { token: tokenAus(mail, 'a') },
    }
  );
  assert.equal(bestaetigt.status, 201);
  const token = json<{ token: string }>(bestaetigt).token;
  const ansicht = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  return { token, ansicht };
}

dbTest('a Planung is created by mail confirmation with the template meals', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  assert.equal(ansicht.name, 'Sommerlager');
  assert.equal(ansicht.zugang, 'besitzer');
  assert.deepEqual(
    ansicht.tage.map((tag) => tag.datum),
    ['2027-08-01', '2027-08-02', '2027-08-03']
  );
  assert.deepEqual(
    ansicht.tage[2].mahlzeiten.map((m) => `${m.kennung} ${m.name}`),
    [
      '3_1 Frühstück',
      '3_2 Mittagessen',
      '3_3 Kaffee & Kuchen',
      '3_4 Abendessen',
      '3_5 Mitternachtssnack',
    ]
  );
  assert.equal(ansicht.mitglieder.length, 1);
  assert.equal(ansicht.mitglieder[0].email, BESITZERIN.email);
  assert.equal(ansicht.loeschtAm, '2028-08-03');
  assert.equal(ansicht.aenderungen[0].aktion, 'planung-angelegt');

  // The confirmation link works once
  const wieder = await call(t, endpoints.EssensplanungBestaetigen, 'POST', 'anlegen/bestaetigen', {
    body: { token: tokenAus(mails[0], 'a') },
  });
  assert.equal(wieder.status, 409);

  // Polling answers with the counter only while nothing changed
  const stand = json<{ stand: string; ansicht?: PlanungAnsicht }>(
    await call(t, endpoints.EssensplanungStand, 'GET', 'planung/stand', {
      token,
      query: `?seit=${encodeURIComponent(ansicht.stand)}`,
    })
  );
  assert.deepEqual(stand, { stand: ansicht.stand });
  const alt = json<{ stand: string; ansicht?: PlanungAnsicht }>(
    await call(t, endpoints.EssensplanungStand, 'GET', 'planung/stand', { token, query: '?seit=0' })
  );
  assert.equal(alt.ansicht?.id, ansicht.id);
});

dbTest('externals may only create Planungen when the Steuerung allows it', async (t) => {
  const mails = captureMails(t);
  useAltcha(t);
  const anfrage = async (email: string) =>
    call(t, endpoints.EssensplanungAnlegen, 'POST', 'anlegen', {
      body: {
        email,
        name: 'Bea Bezirk',
        planungName: 'Bezirkslager',
        ersterTag: '2027-07-01',
        letzterTag: '2027-07-02',
        altcha: await solvedAltcha(),
      },
    });
  const abgelehnt = await anfrage('bea@dpsg-bezirk.de');
  assert.equal(abgelehnt.status, 403);
  assert.equal(json(abgelehnt).code, 'ANLEGEN_NICHT_ERLAUBT');
  assert.equal(mails.length, 0);

  await getDb()
    .updateTable('essen.einstellungen')
    .set({ anlegen_extern: true, whitelist: '["dpsg-bezirk.de"]' })
    .execute();
  t.after(async () => {
    await getDb()
      .updateTable('essen.einstellungen')
      .set({ anlegen_extern: false, whitelist: '[]' })
      .execute();
  });
  assert.equal((await anfrage('bea@dpsg-bezirk.de')).status, 200);
  assert.equal((await anfrage('jemand@example.org')).status, 403);
  assert.equal(mails.length, 1);

  const ungueltig = await call(t, endpoints.EssensplanungAnlegen, 'POST', 'anlegen', {
    body: {
      email: 'kein',
      name: '',
      planungName: 'x',
      ersterTag: '2027-07-05',
      letzterTag: '2027-07-01',
    },
  });
  assert.equal(ungueltig.status, 400);
  assert.deepEqual(Object.keys(json<{ fields: object }>(ungueltig).fields).sort(), [
    'email',
    'letzterTag',
    'name',
  ]);
});

dbTest('days and meals change with versions; the shown IDs follow the order', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const fruehstueck = ansicht.tage[0].mahlzeiten[0];

  // Rename and move the breakfast behind lunch
  const geaendert = json<PlanungAnsicht>(
    await call(
      t,
      endpoints.EssensplanungMahlzeit,
      'PATCH',
      `planung/mahlzeiten/${fruehstueck.id}`,
      {
        token,
        params: { id: String(fruehstueck.id) },
        body: { etag: fruehstueck.etag, name: 'Brunch', uhrzeit: '10:30', position: 2 },
      }
    )
  );
  assert.deepEqual(
    geaendert.tage[0].mahlzeiten.slice(0, 2).map((m) => `${m.kennung} ${m.name} ${m.uhrzeit}`),
    ['1_1 Mittagessen null', '1_2 Brunch 10:30']
  );
  assert.equal(geaendert.aenderungen[0].aktion, 'mahlzeit-geaendert');
  assert.equal(geaendert.aenderungen[0].wer, BESITZERIN.name);

  // The old version is rejected with the current view
  const konflikt = await call(
    t,
    endpoints.EssensplanungMahlzeit,
    'PATCH',
    `planung/mahlzeiten/${fruehstueck.id}`,
    {
      token,
      params: { id: String(fruehstueck.id) },
      body: { etag: fruehstueck.etag, name: 'Frühstück' },
    }
  );
  assert.equal(konflikt.status, 409);
  assert.equal(
    json<{ ansicht: PlanungAnsicht }>(konflikt).ansicht.tage[0].mahlzeiten[1].name,
    'Brunch'
  );

  // A day before the first one renumbers all IDs
  const frueher = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungTage, 'POST', 'planung/tage', {
      token,
      body: { datum: '2027-07-31' },
    })
  );
  assert.equal(frueher.tage.length, 4);
  assert.equal(frueher.tage[1].mahlzeiten[1].kennung, '2_2');
  assert.equal(frueher.tage[1].mahlzeiten[1].name, 'Brunch');
  const doppelt = await call(t, endpoints.EssensplanungTage, 'POST', 'planung/tage', {
    token,
    body: { datum: '2027-07-31' },
  });
  assert.equal(doppelt.status, 400);

  // Add a meal at the top, delete one, delete a day
  const tag = frueher.tage[0];
  const mitSnack = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungMahlzeiten, 'POST', 'planung/mahlzeiten', {
      token,
      body: { tagId: tag.id, name: 'Anreise-Snack', position: 1 },
    })
  );
  assert.equal(mitSnack.tage[0].mahlzeiten[0].name, 'Anreise-Snack');
  assert.equal(mitSnack.tage[0].mahlzeiten.length, 6);
  const weg = mitSnack.tage[0].mahlzeiten[1];
  const ohne = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungMahlzeit, 'DELETE', `planung/mahlzeiten/${weg.id}`, {
      token,
      params: { id: String(weg.id) },
      ifMatch: weg.etag,
    })
  );
  assert.deepEqual(
    ohne.tage[0].mahlzeiten.map((m) => m.kennung),
    ['1_1', '1_2', '1_3', '1_4', '1_5']
  );
  const ohneTag = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungTag, 'DELETE', `planung/tage/${tag.id}`, {
      token,
      params: { id: String(tag.id) },
      ifMatch: ohne.tage[0].etag,
    })
  );
  assert.equal(ohneTag.tage[0].datum, '2027-08-01');
});

dbTest('members are invited, join by link and lose access', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);

  const eingeladen = await call(
    t,
    endpoints.EssensplanungMitglieder,
    'POST',
    'planung/mitglieder',
    {
      token,
      body: { name: 'Ben Bezirk', email: 'Ben@Example.org' },
    }
  );
  assert.equal(eingeladen.status, 201);
  const ben = tokenAus(mails.at(-1)!, 't');
  assert.equal(mails.at(-1)!.to, 'ben@example.org');
  const benAnsicht = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token: ben })
  );
  assert.equal(benAnsicht.zugang, 'bearbeiten');
  assert.equal(benAnsicht.darfVerwalten, false);
  assert.equal(benAnsicht.links, null);
  assert.equal(benAnsicht.mitglieder.find((m) => !m.ich)?.email, null);

  // Editors may not invite until the owner allows it
  const nichtErlaubt = await call(
    t,
    endpoints.EssensplanungMitglieder,
    'POST',
    'planung/mitglieder',
    {
      token: ben,
      body: { name: 'Cleo', email: 'cleo@example.org' },
    }
  );
  assert.equal(nichtErlaubt.status, 403);
  await call(t, endpoints.EssensplanungPlanung, 'PATCH', 'planung', {
    token,
    body: { name: 'Sommerlager 2027', mitgliederVerwalten: true },
  });
  assert.equal(
    (
      await call(t, endpoints.EssensplanungMitglieder, 'POST', 'planung/mitglieder', {
        token: ben,
        body: { name: 'Cleo', email: 'cleo@example.org' },
      })
    ).status,
    201
  );
  // …but never make someone owner
  const besitzer = await call(t, endpoints.EssensplanungMitglieder, 'POST', 'planung/mitglieder', {
    token: ben,
    body: { name: 'Dora', email: 'dora@example.org', rolle: 'besitzer' },
  });
  assert.equal(besitzer.status, 403);

  // Shared links: join, read only
  const mitLinks = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungLinks, 'POST', 'planung/links', {
      token,
      body: { art: 'beitritt', an: true },
    })
  );
  const beitritt = mitLinks.links!.beitritt!;
  const lesen = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungLinks, 'POST', 'planung/links', {
      token,
      body: { art: 'lesen', an: true },
    })
  ).links!.lesen!;
  assert.deepEqual(
    json(
      await call(t, endpoints.EssensplanungBeitrittAnsehen, 'POST', 'beitritt/ansehen', {
        body: { token: beitritt },
      })
    ),
    { name: 'Sommerlager 2027' }
  );
  const beigetreten = await call(t, endpoints.EssensplanungBeitreten, 'POST', 'beitritt', {
    body: { token: beitritt, name: 'Eli' },
  });
  assert.equal(beigetreten.status, 201);
  const eli = json<{ token: string }>(beigetreten).token;
  assert.equal(
    json<PlanungAnsicht>(
      await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token: eli })
    ).zugang,
    'bearbeiten'
  );

  const leser = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token: lesen })
  );
  assert.equal(leser.zugang, 'lesen');
  assert.deepEqual(leser.mitglieder, []);
  const leserAendert = await call(t, endpoints.EssensplanungTage, 'POST', 'planung/tage', {
    token: lesen,
    body: { datum: '2027-08-04' },
  });
  assert.equal(leserAendert.status, 403);

  // Switching the join link off stops it
  await call(t, endpoints.EssensplanungLinks, 'POST', 'planung/links', {
    token,
    body: { art: 'beitritt', an: false },
  });
  assert.equal(
    (
      await call(t, endpoints.EssensplanungBeitreten, 'POST', 'beitritt', {
        body: { token: beitritt, name: 'Fritz' },
      })
    ).status,
    404
  );

  // Removing access: the link stops at once; the last owner stays
  const ansicht = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  const benMitglied = ansicht.mitglieder.find((m) => m.name === 'Ben Bezirk')!;
  const entzogen = await call(
    t,
    endpoints.EssensplanungMitglied,
    'DELETE',
    `planung/mitglieder/${benMitglied.id}`,
    {
      token,
      params: { id: String(benMitglied.id) },
      ifMatch: benMitglied.etag,
    }
  );
  assert.equal(entzogen.status, 200);
  assert.equal(
    (await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token: ben })).status,
    404
  );
  const ich = ansicht.mitglieder.find((m) => m.ich)!;
  const letzte = await call(
    t,
    endpoints.EssensplanungMitglied,
    'DELETE',
    `planung/mitglieder/${ich.id}`,
    {
      token,
      params: { id: String(ich.id) },
      ifMatch: ich.etag,
    }
  );
  assert.equal(letzte.status, 400);
});

dbTest('„Meine Planungen“ mails new links and the old ones stop working', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const meine = async () =>
    call(t, endpoints.EssensplanungMeine, 'POST', 'meine', {
      body: { email: BESITZERIN.email, altcha: await solvedAltcha() },
    });
  // Right after creating, the cooldown is not running (no link mail yet)
  assert.equal((await meine()).status, 200);
  const mail = mails.at(-1)!;
  assert.equal(mail.subject, 'Deine Essensplanungen');
  const neu = tokenAus(mail, 't');
  assert.equal(
    (await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })).status,
    404
  );
  assert.equal(
    (await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token: neu })).status,
    200
  );

  // A second request within the waiting time sends nothing, with the same answer
  const anzahl = mails.length;
  const zweite = await meine();
  assert.equal(zweite.status, 200);
  assert.equal(mails.length, anzahl);
  const unbekannt = await call(t, endpoints.EssensplanungMeine, 'POST', 'meine', {
    body: { email: 'niemand@example.org', altcha: await solvedAltcha() },
  });
  assert.deepEqual(json(unbekannt), { email: 'niemand@example.org' });
});

dbTest('two requests for new links at once send one working link', async (t) => {
  const mails = captureMails(t);
  await anlegen(t, mails);
  const anfrage = async () =>
    call(t, endpoints.EssensplanungMeine, 'POST', 'meine', {
      body: { email: BESITZERIN.email, altcha: await solvedAltcha() },
    });
  const vorher = mails.length;
  await Promise.all([anfrage(), anfrage()]);
  const neue = mails.slice(vorher);
  assert.equal(neue.length, 1);
  assert.equal(
    (
      await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', {
        token: tokenAus(neue[0], 't'),
      })
    ).status,
    200
  );
});

dbTest(
  'the settings save only changed fields; the same field changed meanwhile conflicts',
  async (t) => {
    const mails = captureMails(t);
    const { token, ansicht } = await anlegen(t, mails);
    const patch = (body: unknown) =>
      call(t, endpoints.EssensplanungPlanung, 'PATCH', 'planung', { token, body });
    // Another owner switches on member management
    assert.equal(
      (await patch({ mitgliederVerwalten: true, vorher: { mitgliederVerwalten: false } })).status,
      200
    );
    // A rename from a form opened before keeps it on
    const umbenannt = await patch({
      name: 'Sommerlager 2027',
      vorher: { name: ansicht.name, mitgliederVerwalten: false },
    });
    assert.equal(umbenannt.status, 200);
    assert.equal(json<PlanungAnsicht>(umbenannt).mitgliederVerwalten, true);
    // Renaming from the old name again is a conflict and keeps the newer name
    const konflikt = await patch({ name: 'Herbstlager', vorher: { name: ansicht.name } });
    assert.equal(konflikt.status, 409);
    assert.equal(json<{ ansicht: PlanungAnsicht }>(konflikt).ansicht.name, 'Sommerlager 2027');
  }
);

dbTest('a link mail that fails keeps the old link and allows a new try', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  t.mock.method(essenMail, 'send', async () => {
    throw new Error('Graph down');
  });
  const meine = async () =>
    call(t, endpoints.EssensplanungMeine, 'POST', 'meine', {
      body: { email: BESITZERIN.email, altcha: await solvedAltcha() },
    });
  // Same answer as for any address, but nothing changed
  assert.deepEqual(json(await meine()), { email: BESITZERIN.email });
  assert.equal(
    (await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })).status,
    200
  );
  // Without the waiting time, the next request sends the mail once it works again
  const wieder = captureMails(t);
  assert.equal((await meine()).status, 200);
  assert.equal(wieder.at(-1)?.subject, 'Deine Essensplanungen');
});

dbTest('a confirmation link opened twice at once creates one Planung', async (t) => {
  const mails = captureMails(t);
  useAltcha(t);
  neueBesitzerin();
  await call(t, endpoints.EssensplanungAnlegen, 'POST', 'anlegen', {
    body: {
      ...BESITZERIN,
      planungName: 'Doppelt',
      ersterTag: '2027-08-01',
      letzterTag: '2027-08-01',
      altcha: await solvedAltcha(),
    },
  });
  const bestaetigen = () =>
    call(t, endpoints.EssensplanungBestaetigen, 'POST', 'anlegen/bestaetigen', {
      body: { token: tokenAus(mails.at(-1)!, 'a') },
    });
  const antworten = await Promise.all([bestaetigen(), bestaetigen()]);
  assert.deepEqual(antworten.map((antwort) => antwort.status).sort(), [201, 409]);
  const besitzer = await getDb()
    .selectFrom('essen.mitglied')
    .select('id')
    .where('email', '=', BESITZERIN.email)
    .execute();
  assert.equal(besitzer.length, 1);
});

dbTest('an owner who lost the role meanwhile cannot hand out owner rights', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const zugang = await ladeZugang(token);
  assert.equal(zugang.zugang, 'besitzer');
  // Demoted after the link was read; editors may manage members here
  await getDb()
    .updateTable('essen.planung')
    .set({ mitglieder_verwalten: true })
    .where('id', '=', zugang.planungId)
    .execute();
  await getDb()
    .updateTable('essen.mitglied')
    .set({ rolle: 'bearbeiten' })
    .where('id', '=', zugang.mitgliedId!)
    .execute();
  await assert.rejects(
    einladen(zugang, { name: 'Neue Besitzerin', email: 'neu@example.org', rolle: 'besitzer' }),
    (error: unknown) => error instanceof PlanungError && error.status === 403
  );
  // Nor delete the Planung
  await assert.rejects(
    planungLoeschen(zugang),
    (error: unknown) => error instanceof PlanungError && error.status === 403
  );
  // As an editor the invitation itself still works
  await einladen(zugang, { name: 'Ben', email: 'ben@example.org', rolle: 'bearbeiten' });
});

dbTest('previews show the link instead of sending mail', async (t) => {
  const mails = captureMails(t);
  overrideConfig(t, CONFIG.database, { server: CONFIG.database.previewServer });
  useAltcha(t);
  neueBesitzerin();
  const angelegt = await call(t, endpoints.EssensplanungAnlegen, 'POST', 'anlegen', {
    body: {
      ...BESITZERIN,
      planungName: 'Vorschau',
      ersterTag: '2027-08-01',
      letzterTag: '2027-08-01',
      altcha: await solvedAltcha(),
    },
  });
  assert.equal(mails.length, 0);
  assert.match(String(json(angelegt).vorschauLink), /\/essensplanung\/bestaetigen#a=/);
});

dbTest('the maintenance mode stops changes but not reading', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  await getDb().updateTable('essen.einstellungen').set({ wartung: true }).execute();
  t.after(async () => {
    await getDb().updateTable('essen.einstellungen').set({ wartung: false }).execute();
  });
  assert.equal(
    (await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })).status,
    200
  );
  // Pages opened before learn about it by polling, and again when it ends
  const gewartet = json<{ stand: string; ansicht?: PlanungAnsicht }>(
    await call(t, endpoints.EssensplanungStand, 'GET', 'planung/stand', {
      token,
      query: `?seit=${encodeURIComponent(ansicht.stand)}`,
    })
  );
  assert.equal(gewartet.ansicht?.wartung, true);
  const tag = ansicht.tage[0];
  const gesperrt = await call(t, endpoints.EssensplanungTag, 'DELETE', `planung/tage/${tag.id}`, {
    token,
    params: { id: String(tag.id) },
    ifMatch: tag.etag,
  });
  assert.equal(gesperrt.status, 503);
  // Deleting the whole Planung is a change too
  assert.equal(
    (await call(t, endpoints.EssensplanungPlanung, 'DELETE', 'planung', { token })).status,
    503
  );
  assert.equal(
    (await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })).status,
    200
  );
});

dbTest('the Steuerung lists and deletes Planungen; the retention warns and deletes', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const admin = new HttpRequest({
    url: 'http://localhost/api/intern/essensplanung/steuerung',
    method: 'GET',
    headers: {
      'x-ms-client-principal': Buffer.from(
        JSON.stringify({
          identityProvider: 'aad',
          userId: 'admin',
          userDetails: 'admin@example.test',
          userRoles: ['authenticated', 'team_leitende', 'team_admin'],
        })
      ).toString('base64'),
    },
  });
  const steuerung = json<EssenSteuerungView>(await EssensplanungSteuerung(admin, context(t)));
  const eintrag = steuerung.planungen.find((planung) => planung.id === ansicht.id)!;
  assert.equal(eintrag.ersterTag, '2027-08-01');
  assert.deepEqual(eintrag.besitzer, [BESITZERIN]);
  assert.equal(eintrag.loeschtAm, loeschDatum('2027-08-03', 12));

  // 14 days before the deletion the owner gets a warning, once
  const warnungen = () =>
    mails.filter((mail) => mail.to === BESITZERIN.email && /gelöscht/.test(mail.subject));
  await raeumeAuf(new Date('2028-07-25T03:00:00Z'));
  assert.equal(warnungen().length, 1);
  assert.match(warnungen()[0].subject, /wird am 3\. August 2028 gelöscht/);
  await raeumeAuf(new Date('2028-07-26T03:00:00Z'));
  assert.equal(warnungen().length, 1);
  // On the day it is gone
  const ergebnis = await raeumeAuf(new Date('2028-08-03T03:00:00Z'));
  assert.ok(ergebnis.geloescht >= 1);
  assert.equal(
    (await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })).status,
    404
  );

  // Deleting from the Steuerung needs the current version
  const zweite = await anlegen(t, mails);
  const liste = json<EssenSteuerungView>(await EssensplanungSteuerung(admin, context(t)));
  const planung = liste.planungen.find((p) => p.id === zweite.ansicht.id)!;
  const loeschen = (etag: string) =>
    EssensplanungListeEintrag(
      new HttpRequest({
        url: `http://localhost/api/intern/pflege/essensplanung/planungen/${planung.id}`,
        method: 'DELETE',
        headers: {
          'x-ms-client-principal': admin.headers.get('x-ms-client-principal')!,
          'if-match': etag,
        },
        params: { liste: 'planungen', id: String(planung.id) },
      }),
      context(t)
    );
  assert.equal((await loeschen('"0000000000000000"')).status, 409);
  const geloescht = await loeschen(planung.etag);
  assert.equal(geloescht.status, 200);
  assert.equal(json<EssenSteuerungView>(geloescht).log[0].action, 'planung-geloescht');
  assert.equal(
    (await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token: zweite.token }))
      .status,
    404
  );
});

dbTest('a failed warning before the deletion is sent again the next day', async (t) => {
  const mails = captureMails(t);
  await anlegen(t, mails);
  const besitzerin = BESITZERIN.email;
  t.mock.method(essenMail, 'send', async () => {
    throw new Error('Graph down');
  });
  assert.ok((await raeumeAuf(new Date('2028-07-21T03:00:00Z'))).mailFehler >= 1);
  const wieder = captureMails(t);
  const warnungen = () => wieder.filter((mail) => mail.to === besitzerin);
  await raeumeAuf(new Date('2028-07-22T03:00:00Z'));
  assert.equal(warnungen().length, 1);
  await raeumeAuf(new Date('2028-07-23T03:00:00Z'));
  assert.equal(warnungen().length, 1);
});

dbTest('previews get one invented Planung without a usable link', async () => {
  await seedPreviewEssensplanungPlanung(new Date('2027-05-01T10:00:00Z'));
  await seedPreviewEssensplanungPlanung(new Date('2027-05-01T10:00:00Z'));
  const db = getDb();
  const planungen = await db
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .execute();
  assert.equal(planungen.length, 1);
  const tage = await db
    .selectFrom('essen.tag')
    .select('datum')
    .where('planung_id', '=', planungen[0].id)
    .execute();
  assert.equal(tage.length, 7);
  const besitzer = await db
    .selectFrom('essen.mitglied')
    .select(['name', 'rolle'])
    .where('planung_id', '=', planungen[0].id)
    .execute();
  assert.deepEqual(besitzer, [{ name: 'Vroni Vorschau', rolle: 'besitzer' }]);
});

dbTest('requests to create at the same time stay within the limit per hour', async (t) => {
  const mails = captureMails(t);
  useAltcha(t);
  const anfrage = async () =>
    call(t, endpoints.EssensplanungAnlegen, 'POST', 'anlegen', {
      body: {
        email: 'eilig@stamm-phoenix.de',
        name: 'Eli Eilig',
        planungName: 'Wochenende',
        ersterTag: '2027-06-01',
        letzterTag: '2027-06-02',
        altcha: await solvedAltcha(),
      },
    });
  assert.equal((await anfrage()).status, 200);
  assert.equal((await anfrage()).status, 200);
  const gleichzeitig = await Promise.all([anfrage(), anfrage(), anfrage(), anfrage()]);
  assert.deepEqual(gleichzeitig.map((antwort) => antwort.status).sort(), [200, 429, 429, 429]);
  assert.equal(mails.length, 3);
});

dbTest('a Planung without days shows the deletion from the day it was created', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  let aktuell = ansicht;
  for (const tag of ansicht.tage) {
    const etag = aktuell.tage.find((eintrag) => eintrag.id === tag.id)!.etag;
    aktuell = json<PlanungAnsicht>(
      await call(t, endpoints.EssensplanungTag, 'DELETE', `planung/tage/${tag.id}`, {
        token,
        params: { id: String(tag.id) },
        ifMatch: etag,
      })
    );
  }
  assert.equal(aktuell.tage.length, 0);
  const erstellt = (
    await getDb()
      .selectFrom('essen.planung')
      .select('erstellt_am')
      .where('id', '=', ansicht.id)
      .executeTakeFirstOrThrow()
  ).erstellt_am
    .toISOString()
    .slice(0, 10);
  assert.equal(aktuell.loeschtAm, loeschDatum(erstellt, 12));
});
