import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import sharp from 'sharp';
import * as endpoints from '../endpoints/essensplanung';
import * as belege from '../endpoints/essensplanung-belege';
import * as blobStorage from '../lib/blob-storage';
import { CONFIG } from '../lib/config';
import { getDb } from '../lib/db';
import { seedPreviewEssensplanungBelege } from '../lib/db-preview-essen-belege';
import { seedPreviewEssensplanung, seedPreviewEssensplanungPlanung } from '../lib/db-preview';
import { ladeZugang, planungLoeschen } from '../lib/essen-planung';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { overrideConfig } from './fixtures/config';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, context, json } from './fixtures/essensplanung';

type Fehler = { fields: Record<string, string> };

/** Blob Storage in memory. */
function speicher(t: TestContext): Map<string, Buffer> {
  const blobs = new Map<string, Buffer>();
  t.mock.method(blobStorage, 'putBlob', async (name: string, bytes: Uint8Array) => {
    blobs.set(name, Buffer.from(bytes));
  });
  t.mock.method(blobStorage, 'getBlob', async (name: string) => blobs.get(name));
  t.mock.method(blobStorage, 'deleteBlob', async (name: string) => {
    blobs.delete(name);
  });
  t.mock.method(blobStorage, 'listBlobs', async (prefix: string) =>
    [...blobs.keys()]
      .filter((name) => name.startsWith(prefix))
      // Old enough to be swept when no receipt names them
      .map((name) => ({ name, lastModified: new Date(Date.now() - 3_600_000) }))
  );
  return blobs;
}

async function foto(): Promise<string> {
  return (
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#f4f1e8' } })
      .jpeg()
      .toBuffer()
  ).toString('base64');
}

const BELEG = { datum: '2026-10-01', betragCent: 4250, haendler: 'Rewe' };

function neu(t: TestContext, token: string, body: object) {
  return call(t, belege.EssensplanungBelege, 'POST', 'planung/belege', { token, body });
}

function aendern(t: TestContext, token: string, id: number, body: object) {
  return call(t, belege.EssensplanungBeleg, 'PATCH', `planung/belege/${id}`, {
    token,
    params: { id: String(id) },
    body,
  });
}

function fotoRufen(t: TestContext, token: string, id: number, method: string, opt = {}) {
  return call(t, belege.EssensplanungBelegFoto, method, `planung/belege/${id}/foto`, {
    token,
    params: { id: String(id) },
    ...opt,
  });
}

dbTest('receipts are added with or without a photo and marked as paid back', async (t) => {
  const mails = captureMails(t);
  const blobs = speicher(t);
  const { token, ansicht } = await anlegen(t, mails);
  assert.deepEqual(ansicht.belege, []);
  const ich = ansicht.mitglieder.find((m) => m.ich)!;

  const ohne = await neu(t, token, { ...BELEG, bezahltVonId: ich.id });
  assert.equal(ohne.status, 201, JSON.stringify(ohne.jsonBody));
  const mit = await neu(t, token, {
    datum: '2026-10-02',
    betragCent: 1999,
    haendler: 'Bäcker',
    bezahltVonText: 'Oma Inge',
    photo: await foto(),
  });
  assert.equal(mit.status, 201, JSON.stringify(mit.jsonBody));
  let liste = json<PlanungAnsicht>(mit).belege;
  assert.deepEqual(
    liste.map((b) => [b.haendler, b.bezahltVon, b.foto, b.erstattet, b.angelegtVon]),
    [
      ['Bäcker', 'Oma Inge', 'bild', false, 'Kim Küche'],
      ['Rewe', 'Kim Küche', null, false, 'Kim Küche'],
    ]
  );
  const ordner = `essen-belege/${ansicht.id}/`;
  assert.equal([...blobs.keys()].filter((name) => name.startsWith(ordner)).length, 1);

  // The photo and its preview come for the token of the Planung only
  const bild = await fotoRufen(t, token, liste[0].id, 'GET', { query: '?art=vorschau' });
  assert.equal(bild.status, 200);
  assert.equal((bild.headers as Record<string, string>)['Content-Type'], 'image/jpeg');
  assert.equal((await fotoRufen(t, token, liste[1].id, 'GET')).status, 404);

  // Paid back: who marked it and when
  const erstattet = await aendern(t, token, liste[1].id, { etag: liste[1].etag, erstattet: true });
  assert.equal(erstattet.status, 200, JSON.stringify(erstattet.jsonBody));
  liste = json<PlanungAnsicht>(erstattet).belege;
  assert.equal(liste[1].erstattet, true);
  assert.equal(liste[1].erstattetVon, 'Kim Küche');
  assert.ok(liste[1].erstattetAm);
  // An outdated version is a conflict with the current view
  const alt = await aendern(t, token, liste[1].id, { etag: ansicht.etag, betragCent: 1 });
  assert.equal(alt.status, 409);

  // Changing who paid to someone not in the Planung is refused
  const fremd = await aendern(t, token, liste[1].id, { etag: liste[1].etag, bezahltVonId: 99999 });
  assert.equal(fremd.status, 400);
  assert.equal(json<Fehler>(fremd).fields.bezahltVonId, 'Bitte aus der Liste wählen.');

  // Replacing the photo deletes the old file, deleting the receipt the new one
  const vorher = [...blobs.keys()];
  const ersetzt = await fotoRufen(t, token, liste[0].id, 'PUT', {
    body: { etag: liste[0].etag, photo: await foto() },
  });
  assert.equal(ersetzt.status, 200, JSON.stringify(ersetzt.jsonBody));
  assert.equal(vorher.filter((name) => blobs.has(name) && name.endsWith('.jpg')).length, 0);
  liste = json<PlanungAnsicht>(ersetzt).belege;
  const geloescht = await call(t, belege.EssensplanungBeleg, 'DELETE', 'planung/belege', {
    token,
    params: { id: String(liste[0].id) },
    ifMatch: liste[0].etag,
  });
  assert.equal(geloescht.status, 200);
  assert.equal([...blobs.keys()].filter((name) => name.startsWith(ordner)).length, 0);
  assert.equal(json<PlanungAnsicht>(geloescht).belege.length, 1);
});

dbTest('the read-only link sees receipts and photos but changes nothing', async (t) => {
  const mails = captureMails(t);
  speicher(t);
  const { token, ansicht } = await anlegen(t, mails);
  const ich = ansicht.mitglieder.find((m) => m.ich)!;
  const angelegt = json<PlanungAnsicht>(
    await neu(t, token, { ...BELEG, bezahltVonId: ich.id, photo: await foto() })
  );
  const links = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungLinks, 'POST', 'planung/links', {
      token,
      body: { art: 'lesen', an: true },
    })
  );
  const lesen = links.links!.lesen!;
  const gelesen = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token: lesen })
  );
  const beleg = gelesen.belege[0];
  assert.equal(beleg.bezahltVon, 'Kim Küche');
  assert.equal((await fotoRufen(t, lesen, beleg.id, 'GET')).status, 200);
  assert.equal((await neu(t, lesen, { ...BELEG, bezahltVonText: 'Ben' })).status, 403);
  assert.equal(
    (await aendern(t, lesen, beleg.id, { etag: beleg.etag, erstattet: true })).status,
    403
  );

  await getDb().updateTable('essen.einstellungen').set({ wartung: true }).execute();
  t.after(async () => {
    await getDb().updateTable('essen.einstellungen').set({ wartung: false }).execute();
  });
  assert.equal(
    (await aendern(t, token, angelegt.belege[0].id, { etag: beleg.etag, erstattet: true })).status,
    503
  );
});

dbTest('the check answers without a model and refuses the read-only link', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  overrideConfig(t, CONFIG.essensplanung.ki, { deployment: '' });
  const pruefen = (tokenWert: string, body: Buffer) =>
    belege.EssensplanungBelegPruefung(
      new HttpRequest({
        url: 'https://www.stamm-phoenix.de/api/essensplanung/planung/belege/pruefung',
        method: 'POST',
        headers: { 'x-essensplanung-token': tokenWert },
        body: { bytes: new Uint8Array(body) },
      }),
      context(t)
    );
  const jpeg = Buffer.from(await foto(), 'base64');
  const antwort = await pruefen(token, jpeg);
  assert.equal(antwort.status, 200);
  assert.deepEqual(json(antwort), { available: false, check: null, rotation: 0 });
  assert.equal((await pruefen(token, Buffer.from('kein Foto'))).status, 400);
});

dbTest('deleting a Planung deletes its receipts and their photos first', async (t) => {
  const mails = captureMails(t);
  const blobs = speicher(t);
  const { token, ansicht } = await anlegen(t, mails);
  const ich = ansicht.mitglieder.find((m) => m.ich)!;
  await neu(t, token, { ...BELEG, bezahltVonId: ich.id, photo: await foto() });
  await neu(t, token, { ...BELEG, bezahltVonText: 'Ben' });
  assert.equal([...blobs.keys()].length, 1);
  await planungLoeschen(await ladeZugang(token));
  assert.equal([...blobs.keys()].length, 0);
  const rest = await getDb()
    .selectFrom('essen.beleg')
    .select('id')
    .where('planung_id', '=', ansicht.id)
    .execute();
  assert.equal(rest.length, 0);
});

dbTest('the preview gets invented receipts once', async () => {
  await seedPreviewEssensplanung();
  await seedPreviewEssensplanungPlanung();
  await seedPreviewEssensplanungBelege();
  await seedPreviewEssensplanungBelege();
  const planung = await getDb()
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .executeTakeFirstOrThrow();
  const rows = await getDb()
    .selectFrom('essen.beleg')
    .select(['erstattet', 'foto'])
    .where('planung_id', '=', planung.id)
    .execute();
  assert.equal(rows.length, 3);
  assert.ok(rows.some((row) => row.erstattet));
  assert.ok(rows.every((row) => row.foto === null));
});
