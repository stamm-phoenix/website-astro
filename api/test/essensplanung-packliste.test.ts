import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import * as endpoints from '../endpoints/essensplanung';
import * as packliste from '../endpoints/essensplanung-packliste';
import { getDb } from '../lib/db';
import { seedPreviewEssensplanungEinkauf } from '../lib/db-preview-essen-einkauf';
import { seedPreviewEssensplanungPackliste } from '../lib/db-preview-essen-packliste';
import {
  seedPreviewEssensplanung,
  seedPreviewEssensplanungEinplanung,
  seedPreviewEssensplanungGerichte,
  seedPreviewEssensplanungPlanung,
} from '../lib/db-preview';
import { ladeZugang, planungLoeschen } from '../lib/essen-planung';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

type Fehler = { fields: Record<string, string> };

async function gericht(
  t: TestContext,
  token: string,
  name: string,
  werkzeuge: string[]
): Promise<number> {
  const antwort = await call(t, endpoints.EssensplanungGerichte, 'POST', 'planung/gerichte', {
    token,
    body: { name, personen: 10, werkzeuge },
  });
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  return json<{ id: number }>(antwort).id;
}

async function einplanen(t: TestContext, token: string, mahlzeitId: number, gerichtId: number) {
  const antwort = await call(
    t,
    endpoints.EssensplanungEinplanungen,
    'POST',
    'planung/einplanungen',
    {
      token,
      body: { mahlzeitId, gerichtId },
    }
  );
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  return json<PlanungAnsicht>(antwort);
}

function neu(t: TestContext, token: string, body: object) {
  return call(t, packliste.EssensplanungPackliste, 'POST', 'planung/packliste', { token, body });
}

function werkzeug(t: TestContext, token: string, body: object) {
  return call(t, packliste.EssensplanungPackWerkzeug, 'PUT', 'planung/packliste/werkzeug', {
    token,
    body,
  });
}

function aendern(t: TestContext, token: string, id: number, body: object) {
  return call(t, packliste.EssensplanungPackEintrag, 'PATCH', `planung/packliste/${id}`, {
    token,
    params: { id: String(id) },
    body,
  });
}

function loeschen(t: TestContext, token: string, id: number, ifMatch: string) {
  return call(t, packliste.EssensplanungPackEintrag, 'DELETE', `planung/packliste/${id}`, {
    token,
    params: { id: String(id) },
    ifMatch,
  });
}

dbTest('tools of planned dishes get a state when someone packs them', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  assert.deepEqual(ansicht.packliste, []);
  const chili = await gericht(t, token, 'Chili', ['Großer Topf', 'Kochlöffel']);
  const suppe = await gericht(t, token, 'Suppe', ['großer topf ', 'Pürierstab']);
  const mittag = ansicht.tage[0].mahlzeiten[1];

  // Only tools of planned dishes count; the soup is not planned yet
  await einplanen(t, token, mittag.id, chili);
  const ungeplant = await werkzeug(t, token, { werkzeug: 'Pürierstab', etag: null, gepackt: true });
  assert.equal(ungeplant.status, 400);
  assert.deepEqual(json<Fehler>(ungeplant).fields, {
    werkzeug: 'Kein eingeplantes Gericht braucht dieses Werkzeug mehr.',
  });
  await einplanen(t, token, mittag.id, suppe);

  // The first change stores the tool under its merged name, with the name of the first dish
  const anders = await werkzeug(t, token, { werkzeug: 'GROSSER Topf', etag: null, gepackt: true });
  assert.equal(anders.status, 400, 'ß is not ss');
  const topf = json<PlanungAnsicht>(
    await werkzeug(t, token, { werkzeug: ' großer  TOPF', etag: null, gepackt: true })
  );
  assert.deepEqual(
    topf.packliste.map(({ werkzeug: w, name, gepackt: g, zustaendig }) => [w, name, g, zustaendig]),
    [['großer topf', 'Großer Topf', true, '']]
  );
  assert.equal(topf.aenderungen[0].aktion, 'packliste-geaendert');
  assert.deepEqual(topf.aenderungen[0].details, { name: 'Großer Topf', gepackt: true });

  // Someone else who saw no row yet gets a conflict with the current view
  const zweiter = await werkzeug(t, token, {
    werkzeug: 'Großer Topf',
    etag: null,
    zustaendigText: 'Ben',
  });
  assert.equal(zweiter.status, 409);
  assert.equal(
    json<{ ansicht: PlanungAnsicht }>(zweiter).ansicht.packliste[0].etag,
    topf.packliste[0].etag
  );

  // With the version: who packs it; only that field changes
  const ich = ansicht.mitglieder.find((m) => m.ich)!;
  const zustaendig = json<PlanungAnsicht>(
    await werkzeug(t, token, {
      werkzeug: 'Großer Topf',
      etag: topf.packliste[0].etag,
      zustaendigId: ich.id,
    })
  );
  assert.deepEqual(
    zustaendig.packliste.map((e) => [e.gepackt, e.zustaendigId, e.zustaendig]),
    [[true, ich.id, ich.name]]
  );
  // The old version is a conflict, also over the row's own route
  const veraltet = await aendern(t, token, topf.packliste[0].id, {
    etag: topf.packliste[0].etag,
    gepackt: false,
  });
  assert.equal(veraltet.status, 409);
  const ausgepackt = json<PlanungAnsicht>(
    await aendern(t, token, topf.packliste[0].id, {
      etag: zustaendig.packliste[0].etag,
      gepackt: false,
      zustaendigText: 'Küchenteam',
    })
  );
  assert.deepEqual(
    ausgepackt.packliste.map((e) => [e.gepackt, e.zustaendigId, e.zustaendig]),
    [[false, null, 'Küchenteam']]
  );

  // A tool cannot be taken off the list, and its row stays when the dish is no longer planned
  const weg = await loeschen(t, token, topf.packliste[0].id, ausgepackt.packliste[0].etag);
  assert.equal(weg.status, 400);
  const einplanungen = ausgepackt.tage[0].mahlzeiten[1].einplanungen;
  // The last first, so the one before keeps its place and its version
  for (const einplanung of [...einplanungen].reverse()) {
    const entfernt = await call(
      t,
      endpoints.EssensplanungEinplanung,
      'DELETE',
      `planung/einplanungen/${einplanung.id}`,
      { token, params: { id: String(einplanung.id) }, ifMatch: einplanung.etag }
    );
    assert.equal(entfernt.status, 200, JSON.stringify(entfernt.jsonBody));
  }
  const ohne = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  assert.equal(ohne.packliste.length, 1);
  const spaeter = await werkzeug(t, token, {
    werkzeug: 'Großer Topf',
    etag: ohne.packliste[0].etag,
    gepackt: true,
  });
  assert.equal(spaeter.status, 400);
});

dbTest('entries of its own are added once, packed and taken off', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const chili = await gericht(t, token, 'Chili', ['Gaskocher']);
  await einplanen(t, token, ansicht.tage[0].mahlzeiten[0].id, chili);

  assert.deepEqual(json<Fehler>(await neu(t, token, { name: ' ' })).fields, {
    name: 'Bitte eintragen, was eingepackt werden soll, z. B. „Gaskocher“.',
  });
  // A tool of the dishes is already on the list
  assert.deepEqual(json<Fehler>(await neu(t, token, { name: 'gaskocher' })).fields, {
    name: 'Das steht schon auf der Packliste.',
  });
  const mitZelt = json<PlanungAnsicht>(
    await neu(t, token, { name: 'Küchenzelt', zustaendigText: 'Rover' })
  );
  assert.deepEqual(
    mitZelt.packliste.map(({ werkzeug: w, name, gepackt, zustaendig }) => [
      w,
      name,
      gepackt,
      zustaendig,
    ]),
    [[null, 'Küchenzelt', false, 'Rover']]
  );
  assert.equal(mitZelt.aenderungen[0].aktion, 'packliste-neu');
  assert.equal((await neu(t, token, { name: 'KÜCHENZELT' })).status, 400);

  // Someone without access is no choice; a member of another Planung neither
  const { id: ben } = await getDb()
    .insertInto('essen.mitglied')
    .values({ planung_id: ansicht.id, name: 'Ben Bezirk', rolle: 'bearbeiten' })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  const zelt = mitZelt.packliste[0];
  const mitBen = json<PlanungAnsicht>(
    await aendern(t, token, zelt.id, { etag: zelt.etag, zustaendigId: ben })
  );
  assert.equal(mitBen.packliste[0].zustaendig, 'Ben Bezirk');
  await getDb()
    .updateTable('essen.mitglied')
    .set({ entzogen_am: new Date() })
    .where('id', '=', ben)
    .execute();
  // Ben stays responsible, the entry can still be packed; chosen anew he is not
  const gepackt = json<PlanungAnsicht>(
    await aendern(t, token, zelt.id, {
      etag: mitBen.packliste[0].etag,
      gepackt: true,
      zustaendigId: ben,
    })
  );
  assert.deepEqual(
    gepackt.packliste.map((e) => [e.gepackt, e.zustaendig]),
    [[true, 'Ben Bezirk']]
  );
  assert.deepEqual(json<Fehler>(await neu(t, token, { name: 'Plane', zustaendigId: ben })).fields, {
    zustaendigId: 'Bitte aus der Liste wählen.',
  });

  // Taking it off needs the current version
  assert.equal((await loeschen(t, token, zelt.id, zelt.etag)).status, 409);
  const leer = json<PlanungAnsicht>(await loeschen(t, token, zelt.id, gepackt.packliste[0].etag));
  assert.deepEqual(leer.packliste, []);
  assert.equal(leer.aenderungen[0].aktion, 'packliste-geloescht');
  assert.equal((await loeschen(t, token, zelt.id, gepackt.packliste[0].etag)).status, 404);

  // The whole Planung goes with its packing list, also with a member responsible
  await neu(t, token, { name: 'Plane', zustaendigId: ansicht.mitglieder[0].id });
  const planungId = (await ladeZugang(token)).planungId;
  await planungLoeschen(await ladeZugang(token));
  const rest = await getDb()
    .selectFrom('essen.packliste_eintrag')
    .select('id')
    .where('planung_id', '=', planungId)
    .execute();
  assert.equal(rest.length, 0);
});

dbTest('the read-only link sees the packing list; maintenance stops changes', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  await neu(t, token, { name: 'Kühlbox' });
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
  assert.deepEqual(
    gelesen.packliste.map((e) => e.name),
    ['Kühlbox']
  );
  const eintrag = gelesen.packliste[0];
  assert.equal((await neu(t, lesen, { name: 'Plane' })).status, 403);
  assert.equal(
    (await aendern(t, lesen, eintrag.id, { etag: eintrag.etag, gepackt: true })).status,
    403
  );

  await getDb().updateTable('essen.einstellungen').set({ wartung: true }).execute();
  t.after(async () => {
    await getDb().updateTable('essen.einstellungen').set({ wartung: false }).execute();
  });
  assert.equal(
    (await aendern(t, token, eintrag.id, { etag: eintrag.etag, gepackt: true })).status,
    503
  );
});

dbTest('the preview gets an invented packing list once', async () => {
  await seedPreviewEssensplanung();
  await seedPreviewEssensplanungPlanung();
  await seedPreviewEssensplanungGerichte();
  await seedPreviewEssensplanungEinplanung();
  await seedPreviewEssensplanungEinkauf();
  await seedPreviewEssensplanungPackliste();
  await seedPreviewEssensplanungPackliste();
  const planung = await getDb()
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .executeTakeFirstOrThrow();
  const eintraege = await getDb()
    .selectFrom('essen.packliste_eintrag')
    .select(['werkzeug', 'name'])
    .where('planung_id', '=', planung.id)
    .execute();
  assert.ok(eintraege.some((e) => e.werkzeug === null && e.name === 'Gaskocher (Test)'));
  assert.ok(eintraege.length <= 2);
});
