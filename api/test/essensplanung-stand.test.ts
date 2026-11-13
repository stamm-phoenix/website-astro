import assert from 'node:assert/strict';
import type { KyselyPlugin } from 'kysely';
import * as endpoints from '../endpoints/essensplanung';
import { getDb } from '../lib/db';
import type { Db } from '../lib/db';
import {
  createKategorie,
  createUnvertraeglichkeit,
  createZutat,
  deleteKategorie,
  renameKategorie,
} from '../lib/essen-katalog-pflege';
import { nummeriereMahlzeiten } from '../lib/essen-mahlzeiten-reihenfolge';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { ladeAnsicht } from '../lib/essen-ansicht';
import { ladeStand } from '../lib/essen-stand';
import { ladeZugang } from '../lib/essen-zugang';
import { listKategorien } from '../lib/essen-steuerung';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

/** The poll of a Planung reads little, the counter of the central lists, renumbering meals. */

/** A database handle that counts the queries sent through it. */
function zaehlend(): { db: Db; anzahl: () => number } {
  let anzahl = 0;
  const plugin: KyselyPlugin = {
    transformQuery: (args) => {
      anzahl += 1;
      return args.node;
    },
    transformResult: async (args) => args.result,
  };
  return { db: getDb().withPlugin(plugin), anzahl: () => anzahl };
}

dbTest('the poll reads the stand in one query and passes it on to the view', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const zugang = await ladeZugang(token);

  const poll = zaehlend();
  const gelesen = await ladeStand(zugang, poll.db);
  assert.equal(poll.anzahl(), 1);

  const mitStand = zaehlend();
  const ansicht = await ladeAnsicht(zugang, mitStand.db, gelesen);
  const ohneStand = zaehlend();
  const nochmal = await ladeAnsicht(zugang, ohneStand.db);
  assert.equal(ansicht.stand, gelesen.stand);
  assert.equal(nochmal.stand, gelesen.stand);
  // The view reads the stand itself only when none is passed on
  assert.equal(ohneStand.anzahl() - mitStand.anzahl(), 1);
});

dbTest('the stand changes with a change of the Planung and with the central lists', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const poll = async (seit: string) =>
    json<{ stand: string; ansicht?: PlanungAnsicht }>(
      await call(t, endpoints.EssensplanungStand, 'GET', 'planung/stand', {
        token,
        query: `?seit=${encodeURIComponent(seit)}`,
      })
    );
  assert.deepEqual(await poll(ansicht.stand), { stand: ansicht.stand });

  // Unchanged: the counter only; changed: the whole view with the new stand
  const kategorie = (await listKategorien())[0];
  const schritte: [string, () => Promise<unknown>][] = [
    ['a new category', () => createKategorie('Testkategorie Stand', 'test')],
    ['a new allergen', () => createUnvertraeglichkeit('Testallergen Stand', 'test')],
    [
      'a new ingredient',
      () =>
        createZutat(
          {
            name: 'Teststand-Zutat',
            kategorieId: kategorie.id,
            einheitenart: 'masse',
            abtropfgewicht: false,
            lebensmittel: true,
            vegetarisch: true,
            vegan: true,
            merkmaleGeprueft: false,
            hinweis: '',
            grammProTl: null,
            grammProEl: null,
            grammProStueck: null,
            allergene: [],
          },
          'test'
        ),
    ],
  ];
  let stand = ansicht.stand;
  for (const [name, schritt] of schritte) {
    await schritt();
    const antwort = await poll(stand);
    assert.ok(antwort.ansicht, `${name} reaches the open Planung with the next poll`);
    assert.notEqual(antwort.stand, stand, name);
    assert.notEqual(antwort.ansicht.katalogStand, ansicht.katalogStand, name);
    stand = antwort.stand;
    assert.deepEqual(await poll(stand), { stand }, `${name}: nothing new afterwards`);
  }

  // Renaming and deleting a category count, too
  const neu = await createKategorie('Kurzlebig', 'test');
  stand = (await poll(stand)).stand;
  const liste = await listKategorien();
  const eintrag = liste.find((k) => k.id === neu)!;
  await renameKategorie(String(neu), 'Kurzlebig 2', eintrag.etag, 'test');
  const umbenannt = await poll(stand);
  assert.ok(umbenannt.ansicht);
  const aktuell = (await listKategorien()).find((k) => k.id === neu)!;
  await deleteKategorie(String(neu), aktuell.etag, 'test');
  const geloescht = await poll(umbenannt.stand);
  assert.ok(geloescht.ansicht);
  assert.notEqual(geloescht.stand, umbenannt.stand);
});

dbTest('a failed change of the central lists does not move the counter', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const zugang = await ladeZugang(token);
  const kategorie = (await listKategorien())[0];
  await assert.rejects(renameKategorie(String(kategorie.id), 'Neu', 'W/"alt"', 'test'));
  assert.equal((await ladeStand(zugang)).stand, ansicht.stand);
});

dbTest('renumbering the meals of a day is one statement and keeps the other days', async (t) => {
  const mails = captureMails(t);
  const { ansicht } = await anlegen(t, mails);
  const [erster, zweiter] = ansicht.tage;
  const ids = erster.mahlzeiten.map((m) => m.id);

  // Move the last meal to the top, then delete one and close the gap
  await nummeriereMahlzeiten(getDb(), erster.id, { id: ids[4], position: 1 });
  await getDb().deleteFrom('essen.mahlzeit').where('id', '=', ids[1]).execute();
  await nummeriereMahlzeiten(getDb(), erster.id);

  const zeilen = await getDb()
    .selectFrom('essen.mahlzeit')
    .select(['id', 'position', 'tag_id'])
    .where('tag_id', 'in', [erster.id, zweiter.id])
    .orderBy('tag_id')
    .orderBy('position')
    .execute();
  assert.deepEqual(
    zeilen.filter((z) => z.tag_id === erster.id).map((z) => [z.id, z.position]),
    [
      [ids[4], 1],
      [ids[0], 2],
      [ids[2], 3],
      [ids[3], 4],
    ]
  );
  assert.deepEqual(
    zeilen.filter((z) => z.tag_id === zweiter.id).map((z) => z.position),
    [1, 2, 3, 4, 5]
  );
});
