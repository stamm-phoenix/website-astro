import assert from 'node:assert/strict';
import { HttpRequest, InvocationContext } from '@azure/functions';
import type { HttpResponseInit } from '@azure/functions';
import * as endpoints from '../endpoints/essensplanung';
import EssensplanungMeineEndpoint from '../endpoints/intern-essensplanung-meine';
import { EssensplanungLeitende } from '../endpoints/essensplanung-leitende';
import * as taskDirectory from '../lib/task-directory';
import { CONFIG } from '../lib/config';
import { getDb } from '../lib/db';
import {
  seedPreviewEssensplanung,
  seedPreviewEssensplanungPlanung,
} from '../lib/db-preview-essen-planung';
import { seedPreviewEssensplanungLeitung } from '../lib/db-preview-essen-leitung';
import type { LeitungPlanung } from '../lib/essen-leitung-model';
import { PlanungError, ladeZugang } from '../lib/essen-zugang';
import { einladen, mitgliedAendern, neueLinksFuerAdresse, neuerLink } from '../lib/essen-planung-mitglieder';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { overrideConfig } from './fixtures/config';
import { dbTest } from './fixtures/database';
import { BESITZERIN, anlegen, call, captureMails, json } from './fixtures/essensplanung';

/** „Meine Essensplanungen“ in the Leitendenbereich (`api/lib/essen-leitung.ts`). */

function meine(
  email: string,
  roles = ['authenticated', 'team_leitende'],
  body?: unknown
): Promise<HttpResponseInit> {
  const principal = {
    identityProvider: 'aad',
    userId: email,
    userDetails: email,
    userRoles: roles,
  };
  return EssensplanungMeineEndpoint(
    new HttpRequest({
      url: 'https://www.stamm-phoenix.de/api/intern/essensplanung/meine',
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
      },
      body: body === undefined ? undefined : { string: JSON.stringify(body) },
    }),
    new InvocationContext()
  );
}

async function planungen(email: string): Promise<LeitungPlanung[]> {
  const response = await meine(email);
  assert.equal(response.status, 200, JSON.stringify(response.jsonBody));
  return json<{ planungen: LeitungPlanung[] }>(response).planungen;
}

const ungueltig = (error: unknown) => error instanceof PlanungError && error.status === 404;

dbTest('a Leitende:r opens own Planungen with the token of the Leitendenbereich', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);

  // The login may differ in case from the stored address
  const [planung, ...rest] = await planungen(BESITZERIN.email.toUpperCase());
  assert.equal(rest.length, 0);
  assert.equal(planung.planungId, ansicht.id);
  assert.equal(planung.name, 'Sommerlager');
  assert.equal(planung.rolle, 'besitzer');
  assert.equal(planung.ersterTag, '2027-08-01');
  assert.equal(planung.letzterTag, '2027-08-03');
  assert.notEqual(planung.token, token);

  // Same access as the link from the mail, which keeps working
  const geoeffnet = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token: planung.token })
  );
  assert.equal(geoeffnet.zugang, 'besitzer');
  assert.equal(geoeffnet.ichId, ansicht.ichId);
  assert.equal((await ladeZugang(token)).mitgliedId, ansicht.ichId);

  // The next visit gets the same token
  assert.equal((await planungen(BESITZERIN.email))[0].token, planung.token);
});

dbTest('a withdrawn member loses the Planung and its token', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const besitzerin = await ladeZugang(token);
  await einladen(besitzerin, { name: 'Ben', email: 'ben@stamm-phoenix.de', rolle: 'bearbeiten' });
  await einladen(besitzerin, { name: 'Eva', email: 'eva@example.org', rolle: 'bearbeiten' });

  const [ben] = await planungen('ben@stamm-phoenix.de');
  assert.equal(ben.rolle, 'bearbeiten');
  assert.equal((await ladeZugang(ben.token)).zugang, 'bearbeiten');

  const ansicht = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  const mitglied = ansicht.mitglieder.find((m) => m.email === 'ben@stamm-phoenix.de')!;
  await mitgliedAendern(besitzerin, mitglied.id, { entziehen: true }, mitglied.etag);

  await assert.rejects(ladeZugang(ben.token), ungueltig);
  assert.deepEqual(await planungen('ben@stamm-phoenix.de'), []);
});

dbTest('only Leitende with an address of the Stamm get the list', async () => {
  const extern = await meine('kim@example.org');
  assert.equal(extern.status, 403);
  assert.equal((extern.jsonBody as { code: string }).code, 'KEINE_STAMM_ADRESSE');

  const ohneTeam = await meine('kim@stamm-phoenix.de', ['authenticated']);
  assert.equal(ohneTeam.status, 403);

  assert.deepEqual(await planungen('niemand@stamm-phoenix.de'), []);
});

dbTest('the preview test account finds the invented Planung once', async (t) => {
  overrideConfig(t, CONFIG.database, { server: CONFIG.database.previewServer });
  await seedPreviewEssensplanung();
  await seedPreviewEssensplanungPlanung();
  await seedPreviewEssensplanungLeitung();
  await seedPreviewEssensplanungLeitung();
  const liste = await planungen(CONFIG.staff.previewOnlyLogins[0]);
  assert.deepEqual(
    liste.map((planung) => [planung.name, planung.rolle]),
    [['Sommerlager (Test)', 'bearbeiten']]
  );
  assert.equal((await ladeZugang(liste[0].token)).zugang, 'bearbeiten');

  // „Meine Planungen“ also works for it, and replaces the token of the Leitendenbereich
  const links = await neueLinksFuerAdresse(CONFIG.staff.previewOnlyLogins[0].toLowerCase());
  assert.deepEqual(
    links.map((link) => link.planungName),
    ['Sommerlager (Test)']
  );
  assert.equal((await ladeZugang(links[0].token)).zugang, 'bearbeiten');
  await assert.rejects(ladeZugang(liste[0].token), ungueltig);
});

dbTest('a new link by mail also replaces the token of the Leitendenbereich', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const besitzerin = await ladeZugang(token);

  // „Meine Planungen“ on the start page
  const vorher = (await planungen(BESITZERIN.email))[0].token;
  await neueLinksFuerAdresse(BESITZERIN.email);
  await assert.rejects(ladeZugang(vorher), ungueltig);
  const danach = (await planungen(BESITZERIN.email))[0].token;
  assert.notEqual(danach, vorher);
  assert.equal((await ladeZugang(danach)).zugang, 'besitzer');

  // „Neuer Link“ for a member
  await einladen(besitzerin, { name: 'Ben', email: 'ben@stamm-phoenix.de', rolle: 'bearbeiten' });
  const [ben] = await planungen('ben@stamm-phoenix.de');
  // The invitation just went out; the waiting time does not matter here
  await getDb()
    .updateTable('essen.mitglied')
    .set({ link_gesendet_am: null })
    .where('email', '=', 'ben@stamm-phoenix.de')
    .execute();
  const neu = await neuerLink(await ladeZugang(danach), (await ladeZugang(ben.token)).mitgliedId!);
  await assert.rejects(ladeZugang(ben.token), ungueltig);
  assert.equal((await ladeZugang(neu.token)).zugang, 'bearbeiten');
});

dbTest('a Leitende:r creates a Planung with name and days only and opens it', async () => {
  const angelegt = await meine('kim.kueche@stamm-phoenix.de', undefined, {
    planungName: 'Herbstlager',
    ersterTag: '2027-10-01',
    letzterTag: '2027-10-03',
  });
  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.jsonBody));
  const { token, planungId } = json<{ token: string; planungId: number }>(angelegt);

  const zugang = await ladeZugang(token);
  assert.equal(zugang.planungId, planungId);
  assert.equal(zugang.zugang, 'besitzer');
  assert.equal(zugang.name, 'Kim Kueche');
  const mitglied = await getDb()
    .selectFrom('essen.mitglied')
    .select(['email', 'token_hash'])
    .where('id', '=', zugang.mitgliedId!)
    .executeTakeFirstOrThrow();
  assert.equal(mitglied.email, 'kim.kueche@stamm-phoenix.de');
  // A link by mail can be requested later („Meine Planungen“ needs a hash to replace)
  assert.ok(mitglied.token_hash);

  const [planung] = await planungen('kim.kueche@stamm-phoenix.de');
  assert.equal(planung.token, token);
  assert.equal(planung.ersterTag, '2027-10-01');
  assert.equal(planung.letzterTag, '2027-10-03');
  assert.equal(planung.rolle, 'besitzer');
});

dbTest(
  'creating from the Leitendenbereich checks the form, the address and the maintenance',
  async () => {
    const leer = await meine('kim@stamm-phoenix.de', undefined, {});
    assert.equal(leer.status, 400);
    assert.deepEqual(Object.keys((leer.jsonBody as { fields: object }).fields).sort(), [
      'ersterTag',
      'letzterTag',
      'planungName',
    ]);

    const gueltig = { planungName: 'Lager', ersterTag: '2027-10-01', letzterTag: '2027-10-01' };
    assert.equal((await meine('kim@example.org', undefined, gueltig)).status, 403);
    assert.equal((await meine('kim@stamm-phoenix.de', ['authenticated'], gueltig)).status, 403);

    await getDb().updateTable('essen.einstellungen').set({ wartung: true }).execute();
    try {
      assert.equal((await meine('kim@stamm-phoenix.de', undefined, gueltig)).status, 503);
    } finally {
      await getDb().updateTable('essen.einstellungen').set({ wartung: false }).execute();
    }
    assert.deepEqual(await planungen('kim@stamm-phoenix.de'), []);
  }
);

function leitende(token: string, email?: string): Promise<HttpResponseInit> {
  const headers: Record<string, string> = { 'x-essensplanung-token': token };
  if (email) {
    const principal = {
      identityProvider: 'aad',
      userId: email,
      userDetails: email,
      userRoles: ['authenticated', 'team_leitende'],
    };
    headers['x-ms-client-principal'] = Buffer.from(JSON.stringify(principal)).toString('base64');
  }
  return EssensplanungLeitende(
    new HttpRequest({
      url: 'https://www.stamm-phoenix.de/api/essensplanung/planung/leitende',
      method: 'GET',
      headers,
    }),
    new InvocationContext()
  );
}

dbTest(
  'those who may invite see the Leitende when logged in to the Leitendenbereich',
  async (t) => {
    const mails = captureMails(t);
    t.mock.method(taskDirectory, 'readTaskDirectory', async () => [
      { name: 'Zoe Zelt', givenName: 'Zoe', login: 'zoe.zelt@stamm-phoenix.de' },
      { name: 'Anna Ast', givenName: 'Anna', login: 'anna.ast@stamm-phoenix.de' },
    ]);
    const { token } = await anlegen(t, mails);

    const liste = await leitende(token, BESITZERIN.email);
    assert.equal(liste.status, 200, JSON.stringify(liste.jsonBody));
    assert.deepEqual(json<{ leitende: unknown[] }>(liste).leitende, [
      { name: 'Anna Ast', email: 'anna.ast@stamm-phoenix.de' },
      { name: 'Zoe Zelt', email: 'zoe.zelt@stamm-phoenix.de' },
    ]);

    // The link alone shows nobody, neither does a login from elsewhere
    assert.equal((await leitende(token)).status, 401);
    assert.equal((await leitende(token, 'kim@example.org')).status, 403);

    // An editor only while the owner lets editors manage the members
    await einladen(await ladeZugang(token), {
      name: 'Ben',
      email: 'ben@stamm-phoenix.de',
      rolle: 'bearbeiten',
    });
    const [ben] = await planungen('ben@stamm-phoenix.de');
    assert.equal((await leitende(ben.token, 'ben@stamm-phoenix.de')).status, 403);
  }
);

dbTest('the list says so when the directory cannot be read', async (t) => {
  const mails = captureMails(t);
  t.mock.method(taskDirectory, 'readTaskDirectory', async () => {
    throw new Error('Graph down');
  });
  const { token } = await anlegen(t, mails);
  assert.equal((await leitende(token, BESITZERIN.email)).status, 502);
});

dbTest('an invitation is new until the Planung is opened', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  assert.equal((await planungen(BESITZERIN.email))[0].neu, false);

  await einladen(await ladeZugang(token), {
    name: 'Ben',
    email: 'ben@stamm-phoenix.de',
    rolle: 'bearbeiten',
  });
  const [eingeladen] = await planungen('ben@stamm-phoenix.de');
  assert.equal(eingeladen.neu, true);

  // Polling does not count, the first load of the Planung does
  await call(t, endpoints.EssensplanungStand, 'GET', 'planung/stand', {
    token: eingeladen.token,
    query: '?seit=0',
  });
  assert.equal((await planungen('ben@stamm-phoenix.de'))[0].neu, true);
  await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token: eingeladen.token });
  await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token: eingeladen.token });
  assert.equal((await planungen('ben@stamm-phoenix.de'))[0].neu, false);
});
