import assert from 'node:assert/strict';
import * as endpoints from '../endpoints/essensplanung';
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
import {
  aendern,
  einplanen,
  gericht,
  loeschen,
  neu,
  personen,
  werkzeug,
  type Fehler,
} from './fixtures/essen-packliste';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

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
    topf.packliste.map(({ werkzeug: w, name, gepackt: g, zuteilungen }) => [
      w,
      name,
      g,
      zuteilungen,
    ]),
    [['großer topf', 'Großer Topf', true, []]]
  );
  assert.equal(topf.aenderungen[0].aktion, 'packliste-geaendert');
  assert.deepEqual(topf.aenderungen[0].details, { name: 'Großer Topf', gepackt: true });

  // Someone else who saw no row yet and packs gets a conflict with the current view
  const zweiter = await werkzeug(t, token, {
    werkzeug: 'Großer Topf',
    etag: null,
    gepackt: false,
  });
  assert.equal(zweiter.status, 409);
  assert.equal(
    json<{ ansicht: PlanungAnsicht }>(zweiter).ansicht.packliste[0].etag,
    topf.packliste[0].etag
  );

  // Persons merge without a version; the first start packed like the tool, later ones not
  const ich = ansicht.mitglieder.find((m) => m.ich)!;
  const ben = json<PlanungAnsicht>(
    await werkzeug(t, token, { werkzeug: 'Großer Topf', etag: null, namen: ['Ben', ' ben '] })
  );
  assert.deepEqual(personen(ben.packliste[0]), [['Ben', true]]);
  assert.equal(ben.packliste[0].gepackt, true);
  const zustaendig = json<PlanungAnsicht>(
    await werkzeug(t, token, {
      werkzeug: 'Großer Topf',
      etag: topf.packliste[0].etag,
      mitglieder: [ich.id],
      namen: ['BEN'],
    })
  );
  assert.deepEqual(personen(zustaendig.packliste[0]), [
    ['Ben', true],
    [ich.name, false],
  ]);
  assert.equal(zustaendig.packliste[0].gepackt, false, 'not everyone packed');
  assert.deepEqual(zustaendig.aenderungen[0].details, { name: 'Großer Topf', hinzu: [ich.name] });
  // The old version is a conflict for packing, also over the row's own route
  const veraltet = await aendern(t, token, topf.packliste[0].id, {
    etag: topf.packliste[0].etag,
    gepackt: true,
  });
  assert.equal(veraltet.status, 409);
  // Packing the whole entry packs everyone; taking off a person needs no version
  const allesGepackt = json<PlanungAnsicht>(
    await aendern(t, token, topf.packliste[0].id, {
      etag: zustaendig.packliste[0].etag,
      gepackt: true,
    })
  );
  assert.deepEqual(personen(allesGepackt.packliste[0]), [
    ['Ben', true],
    [ich.name, true],
  ]);
  const benId = allesGepackt.packliste[0].zuteilungen[0].id;
  const ohneBen = json<PlanungAnsicht>(
    await aendern(t, token, topf.packliste[0].id, { weg: [benId, 999_999] })
  );
  assert.deepEqual(personen(ohneBen.packliste[0]), [[ich.name, true]]);
  assert.deepEqual(ohneBen.aenderungen[0].details, { name: 'Großer Topf', weg: ['Ben'] });
  const ausgepackt = json<PlanungAnsicht>(
    await aendern(t, token, topf.packliste[0].id, {
      etag: ohneBen.packliste[0].etag,
      gepackt: false,
    })
  );
  assert.equal(ausgepackt.packliste[0].gepackt, false);

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
    await neu(t, token, { name: 'Küchenzelt', namen: ['Rover'] })
  );
  assert.deepEqual(
    mitZelt.packliste.map(({ werkzeug: w, name, gepackt }) => [w, name, gepackt]),
    [[null, 'Küchenzelt', false]]
  );
  assert.deepEqual(personen(mitZelt.packliste[0]), [['Rover', false]]);
  assert.equal(mitZelt.aenderungen[0].aktion, 'packliste-neu');
  assert.deepEqual(mitZelt.aenderungen[0].details, { name: 'Küchenzelt', hinzu: ['Rover'] });
  assert.equal((await neu(t, token, { name: 'KÜCHENZELT' })).status, 400);

  // Someone without access is no choice; a member of another Planung neither
  const { id: ben } = await getDb()
    .insertInto('essen.mitglied')
    .values({ planung_id: ansicht.id, name: 'Ben Bezirk', rolle: 'bearbeiten' })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  const zelt = mitZelt.packliste[0];
  const mitBen = json<PlanungAnsicht>(await aendern(t, token, zelt.id, { mitglieder: [ben] }));
  assert.deepEqual(personen(mitBen.packliste[0]), [
    ['Rover', false],
    ['Ben Bezirk', false],
  ]);
  await getDb()
    .updateTable('essen.mitglied')
    .set({ entzogen_am: new Date() })
    .where('id', '=', ben)
    .execute();
  // Ben stays, the entry can still be packed; adding him anew changes nothing, elsewhere he is no
  // choice
  const gepackt = json<PlanungAnsicht>(
    await aendern(t, token, zelt.id, { etag: mitBen.packliste[0].etag, gepackt: true })
  );
  assert.deepEqual(personen(gepackt.packliste[0]), [
    ['Rover', true],
    ['Ben Bezirk', true],
  ]);
  assert.equal((await aendern(t, token, zelt.id, { mitglieder: [ben] })).status, 200);
  assert.deepEqual(json<Fehler>(await neu(t, token, { name: 'Plane', mitglieder: [ben] })).fields, {
    mitglieder: 'Bitte aus der Liste wählen.',
  });

  // Taking it off needs the current version
  assert.equal((await loeschen(t, token, zelt.id, zelt.etag)).status, 409);
  const leer = json<PlanungAnsicht>(await loeschen(t, token, zelt.id, gepackt.packliste[0].etag));
  assert.deepEqual(leer.packliste, []);
  assert.equal(leer.aenderungen[0].aktion, 'packliste-geloescht');
  assert.equal((await loeschen(t, token, zelt.id, gepackt.packliste[0].etag)).status, 404);

  // The whole Planung goes with its packing list, also with a member responsible
  await neu(t, token, { name: 'Plane', mitglieder: [ansicht.mitglieder[0].id] });
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
    .select(['id', 'werkzeug', 'name'])
    .where('planung_id', '=', planung.id)
    .execute();
  assert.ok(eintraege.some((e) => e.werkzeug === null && e.name === 'Gaskocher (Test)'));
  assert.ok(eintraege.length <= 3);
  const schuerze = eintraege.find((e) => e.name === 'Kochschürze (Test)');
  assert.ok(schuerze);
  const zuteilungen = await getDb()
    .selectFrom('essen.packliste_zuteilung')
    .select('gepackt')
    .where('eintrag_id', '=', schuerze.id)
    .execute();
  assert.ok(zuteilungen.length >= 2);
  assert.ok(zuteilungen.some((z) => !z.gepackt));
});

dbTest('a tool whose merged name is longer than its name is packed and assigned', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  // Lower case makes „İ“ two characters: 101 in the merged name
  const name = 'A'.repeat(99) + 'İ';
  const gerichtId = await gericht(t, token, 'Langes Werkzeug', [name]);
  await einplanen(t, token, ansicht.tage[0].mahlzeiten[0].id, gerichtId);
  const gepackt = await werkzeug(t, token, { werkzeug: name, etag: null, gepackt: true });
  assert.equal(gepackt.status, 200, JSON.stringify(gepackt.jsonBody));
  const [eintrag] = json<PlanungAnsicht>(gepackt).packliste;
  assert.equal(eintrag.werkzeug?.length, 101);
  const zustaendig = await werkzeug(t, token, {
    werkzeug: name,
    etag: eintrag.etag,
    namen: ['Rover'],
  });
  assert.equal(zustaendig.status, 200, JSON.stringify(zustaendig.jsonBody));
  const [mitRover] = json<PlanungAnsicht>(zustaendig).packliste;
  assert.deepEqual(
    [mitRover.name, mitRover.gepackt, personen(mitRover)],
    [name, true, [['Rover', true]]]
  );
});

dbTest(
  'a tool named like an entry of its own is that entry: setting the tool is a conflict',
  async (t) => {
    const mails = captureMails(t);
    const { token, ansicht } = await anlegen(t, mails);
    assert.equal((await neu(t, token, { name: 'Gaskocher' })).status, 201);
    // A dish with the tool is planned later; a page that has not seen the entry sets the tool
    const gerichtId = await gericht(t, token, 'Grillen', ['gaskocher']);
    await einplanen(t, token, ansicht.tage[0].mahlzeiten[0].id, gerichtId);
    const veraltet = await werkzeug(t, token, { werkzeug: 'gaskocher', etag: null, gepackt: true });
    assert.equal(veraltet.status, 409);
    assert.deepEqual(
      json<{ ansicht: PlanungAnsicht }>(veraltet).ansicht.packliste.map((e) => [
        e.werkzeug,
        e.name,
      ]),
      [[null, 'Gaskocher']]
    );
    const zeilen = await getDb()
      .selectFrom('essen.packliste_eintrag')
      .select('werkzeug')
      .where('planung_id', '=', ansicht.id)
      .where('werkzeug', 'is not', null)
      .execute();
    assert.equal(zeilen.length, 0);
  }
);
