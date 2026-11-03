import assert from 'node:assert/strict';
import { HttpRequest } from '@azure/functions';
import * as endpoints from '../endpoints/essensplanung';
import { EssensplanungMeineEndpoint } from '../endpoints/intern-essensplanung-meine';
import { CONFIG } from '../lib/config';
import { getDb } from '../lib/db';
import { seedPreviewEssensplanung, seedPreviewEssensplanungPlanung } from '../lib/db-preview';
import { seedPreviewEssensplanungLeitung } from '../lib/db-preview-essen-leitung';
import type { LeitungPlanung } from '../lib/essen-leitung-model';
import {
  PlanungError,
  einladen,
  ladeZugang,
  mitgliedAendern,
  neueLinksFuerAdresse,
  neuerLink,
} from '../lib/essen-planung';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { overrideConfig } from './fixtures/config';
import { dbTest } from './fixtures/database';
import { BESITZERIN, anlegen, call, captureMails, json } from './fixtures/essensplanung';

/** „Meine Essensplanungen“ in the Leitendenbereich (`api/lib/essen-leitung.ts`). */

function meine(email: string, roles = ['authenticated', 'team_leitende']) {
  const principal = {
    identityProvider: 'aad',
    userId: email,
    userDetails: email,
    userRoles: roles,
  };
  return EssensplanungMeineEndpoint(
    new HttpRequest({
      url: 'https://www.stamm-phoenix.de/api/intern/essensplanung/meine',
      method: 'GET',
      headers: {
        'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
      },
    })
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
