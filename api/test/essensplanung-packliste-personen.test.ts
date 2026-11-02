import assert from 'node:assert/strict';
import { getDb } from '../lib/db';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { abhaken, aendern, neu, personen, type Fehler } from './fixtures/essen-packliste';
import { anlegen, captureMails, json } from './fixtures/essensplanung';

dbTest('one thing for several persons: each packs their own share', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const ich = ansicht.mitglieder.find((m) => m.ich)!;
  const { id: alex } = await getDb()
    .insertInto('essen.mitglied')
    .values({ planung_id: ansicht.id, name: 'Alex Rover', rolle: 'bearbeiten' })
    .output('inserted.id')
    .executeTakeFirstOrThrow();

  // „Kochschürze“ for two members and a free name, in the order asked
  const angelegt = json<PlanungAnsicht>(
    await neu(t, token, { name: 'Kochschürze', mitglieder: [ich.id, alex, ich.id], namen: ['Sam'] })
  );
  const [schuerze] = angelegt.packliste;
  assert.deepEqual(personen(schuerze), [
    [ich.name, false],
    ['Alex Rover', false],
    ['Sam', false],
  ]);
  assert.deepEqual(angelegt.aenderungen[0].details, {
    name: 'Kochschürze',
    hinzu: [ich.name, 'Alex Rover', 'Sam'],
  });
  const [kim, alexAnteil, sam] = schuerze.zuteilungen;

  // Each tick is its own; two people ticking at once is no conflict
  const kimGepackt = json<PlanungAnsicht>(
    await abhaken(t, token, kim.id, { etag: kim.etag, gepackt: true })
  );
  assert.deepEqual(kimGepackt.aenderungen[0].details, {
    name: 'Kochschürze',
    gepackt: true,
    fuer: ich.name,
  });
  assert.equal(kimGepackt.packliste[0].gepackt, false);
  const alexGepackt = json<PlanungAnsicht>(
    await abhaken(t, token, alexAnteil.id, { etag: alexAnteil.etag, gepackt: true })
  );
  assert.equal(alexGepackt.packliste[0].gepackt, false);
  // A share on an old version is a conflict
  assert.equal((await abhaken(t, token, kim.id, { etag: kim.etag, gepackt: false })).status, 409);

  // When everyone packed, the whole entry is packed
  const alle = json<PlanungAnsicht>(
    await abhaken(t, token, sam.id, { etag: sam.etag, gepackt: true })
  );
  assert.equal(alle.packliste[0].gepackt, true);

  // Someone added later still has to pack; taking them off again packs the whole once more
  const { id: ben } = await getDb()
    .insertInto('essen.mitglied')
    .values({ planung_id: ansicht.id, name: 'Ben Bezirk', rolle: 'bearbeiten' })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  const mitBen = json<PlanungAnsicht>(
    await aendern(t, token, schuerze.id, { mitglieder: [ben, alex] })
  );
  assert.equal(mitBen.packliste[0].gepackt, false);
  assert.deepEqual(mitBen.aenderungen[0].details, { name: 'Kochschürze', hinzu: ['Ben Bezirk'] });
  const benAnteil = mitBen.packliste[0].zuteilungen.find((z) => z.mitgliedId === ben)!;
  const ohneBen = json<PlanungAnsicht>(
    await aendern(t, token, schuerze.id, { weg: [benAnteil.id] })
  );
  assert.equal(ohneBen.packliste[0].gepackt, true);

  // Unpacking the whole entry opens every share
  const offen = json<PlanungAnsicht>(
    await aendern(t, token, schuerze.id, { etag: ohneBen.packliste[0].etag, gepackt: false })
  );
  assert.deepEqual(
    personen(offen.packliste[0]).map(([, gepackt]) => gepackt),
    [false, false, false]
  );

  // A tick of the whole shown before someone was added is a conflict, so they stay to pack
  const nochBen = json<PlanungAnsicht>(await aendern(t, token, schuerze.id, { mitglieder: [ben] }));
  assert.equal(
    (await aendern(t, token, schuerze.id, { etag: offen.packliste[0].etag, gepackt: true })).status,
    409
  );
  const benAnteilNeu = await getDb()
    .selectFrom('essen.packliste_zuteilung')
    .select('gepackt')
    .where('eintrag_id', '=', schuerze.id)
    .where('mitglied_id', '=', ben)
    .executeTakeFirstOrThrow();
  assert.equal(benAnteilNeu.gepackt, false);

  // Taking everyone off keeps the state of the whole; a share of another Planung is not found
  const niemand = json<PlanungAnsicht>(
    await aendern(t, token, schuerze.id, {
      weg: nochBen.packliste[0].zuteilungen.map((z) => z.id),
    })
  );
  assert.deepEqual(niemand.packliste[0].zuteilungen, []);
  assert.equal(niemand.packliste[0].gepackt, false);
  const fremd = await anlegen(t, mails);
  assert.equal(
    (await abhaken(t, fremd.token, kim.id, { etag: kim.etag, gepackt: true })).status,
    404
  );
});

dbTest('the persons of a change are checked', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  assert.deepEqual(json<Fehler>(await neu(t, token, { name: 'Plane', mitglieder: [0] })).fields, {
    mitglieder: 'Bitte aus der Liste wählen.',
  });
  const andere = await anlegen(t, mails);
  assert.deepEqual(
    json<Fehler>(
      await neu(t, token, { name: 'Plane', mitglieder: [andere.ansicht.mitglieder[0].id] })
    ).fields,
    { mitglieder: 'Bitte aus der Liste wählen.' }
  );
  const namen = Array.from({ length: 50 }, (_, index) => `Person ${index}`);
  const voll = json<PlanungAnsicht>(await neu(t, token, { name: 'Plane', namen }));
  assert.equal(voll.packliste[0].zuteilungen.length, 50);
  assert.deepEqual(
    json<Fehler>(await aendern(t, token, voll.packliste[0].id, { namen: ['Noch eine'] })).fields,
    { namen: 'Höchstens 50 Namen.' }
  );
  // A name there already adds nothing
  assert.equal(
    (await aendern(t, token, voll.packliste[0].id, { namen: ['person 1'] })).status,
    200
  );
  assert.deepEqual(json<Fehler>(await abhaken(t, token, 1, { etag: '"1"' })).fields, {
    gepackt: 'Bitte ankreuzen oder nicht.',
  });
});
