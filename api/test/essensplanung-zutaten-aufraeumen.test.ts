import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import {
  EssensplanungGerichte,
  EssensplanungGerichtZutat,
  EssensplanungGerichtZutaten,
  EssensplanungZutat,
  EssensplanungZutaten,
} from '../endpoints/essensplanung-gerichte';
import { EssensplanungBestandListe } from '../endpoints/essensplanung-einkauf';
import { getDb } from '../lib/db';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

/** Ingredients of a Planung go with their last use; own ones need only their name. */

async function zentraleZutat(name: string): Promise<number> {
  const row = await getDb()
    .selectFrom('essen.zutat')
    .select('id')
    .where('name', '=', name)
    .executeTakeFirstOrThrow();
  return row.id;
}

async function zeile(
  t: TestContext,
  token: string,
  gerichtId: number,
  body: object
): Promise<PlanungAnsicht> {
  const antwort = await call(
    t,
    EssensplanungGerichtZutaten,
    'POST',
    `planung/gerichte/${gerichtId}/zutaten`,
    { token, params: { id: String(gerichtId) }, body }
  );
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  return json<PlanungAnsicht>(antwort);
}

async function zeileLoeschen(
  t: TestContext,
  token: string,
  ansicht: PlanungAnsicht,
  name: string
): Promise<PlanungAnsicht> {
  const zutat = ansicht.zutaten.find((z) => z.name === name)!;
  const weg = ansicht.gerichte
    .flatMap((g) => g.zutaten)
    .find((z) => z.planungZutatId === zutat.id)!;
  const antwort = await call(
    t,
    EssensplanungGerichtZutat,
    'DELETE',
    `planung/gericht-zutaten/${weg.id}`,
    {
      token,
      params: { id: String(weg.id) },
      ifMatch: weg.etag,
    }
  );
  assert.equal(antwort.status, 200, JSON.stringify(antwort.jsonBody));
  return json<PlanungAnsicht>(antwort);
}

dbTest('a typed name becomes an own ingredient that goes with its last line', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const gericht = await call(t, EssensplanungGerichte, 'POST', 'planung/gerichte', {
    token,
    body: { name: 'Chili', personen: 10 },
  });
  assert.equal(gericht.status, 201, JSON.stringify(gericht.jsonBody));
  const { id: gerichtId } = json<{ id: number }>(gericht);
  const hack = await zentraleZutat('Hackfleisch');

  await zeile(t, token, gerichtId, { zutatId: hack, menge: 1, einheit: 'kg' });
  // A name of the list is the ingredient of the list; another one an own one with open details
  const mitListe = await zeile(t, token, gerichtId, {
    neueZutat: 'hackfleisch',
    menge: 200,
    einheit: 'g',
  });
  assert.equal(mitListe.zutaten.filter((z) => z.zutatId === hack).length, 1);
  const ansicht = await zeile(t, token, gerichtId, {
    neueZutat: 'Omas Chiligewürz',
    menge: 30,
    einheit: 'g',
  });
  const eigene = ansicht.zutaten.find((z) => z.name === 'Omas Chiligewürz')!;
  const sonstiges = await getDb()
    .selectFrom('essen.kategorie')
    .select('id')
    .where('name', '=', 'Sonstiges')
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    [
      eigene.zutatId,
      eigene.kategorieId,
      eigene.einheitenart,
      eigene.angabenOffen,
      eigene.lebensmittel,
    ],
    [null, sonstiges.id, 'masse', true, true]
  );

  // Hackfleisch keeps its stock, so it stays when its lines go; the own one goes with its line
  const bestand = await call(t, EssensplanungBestandListe, 'POST', 'planung/bestand', {
    token,
    body: { zutatId: hack, menge: 1, einheit: 'kg', hinweis: '' },
  });
  assert.equal(bestand.status, 201, JSON.stringify(bestand.jsonBody));
  let jetzt = json<PlanungAnsicht>(bestand);
  jetzt = await zeileLoeschen(t, token, jetzt, 'Hackfleisch');
  jetzt = await zeileLoeschen(t, token, jetzt, 'Hackfleisch');
  const alteId = eigene.id;
  jetzt = await zeileLoeschen(t, token, jetzt, 'Omas Chiligewürz');
  assert.deepEqual(
    jetzt.zutaten.map((z) => z.name),
    ['Hackfleisch']
  );

  // A page that still holds the removed id sends the name along: it picks the ingredient again
  const wieder = await zeile(t, token, gerichtId, {
    planungZutatId: alteId,
    neueZutat: 'Omas Chiligewürz',
    menge: 20,
    einheit: 'g',
  });
  const neu = wieder.zutaten.find((z) => z.name === 'Omas Chiligewürz')!;
  assert.notEqual(neu.id, alteId);
  assert.equal(neu.angabenOffen, true);
  assert.equal(jetzt.zutaten[0].zeilen, 1);
});

dbTest('an own ingredient added with just its name stays until it is used', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const angelegt = await call(t, EssensplanungZutaten, 'POST', 'planung/zutaten', {
    token,
    body: { name: 'Vanillepaste', einheit: 'Tube' },
  });
  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.jsonBody));
  const { id, ansicht } = json<{ id: number; ansicht: PlanungAnsicht }>(angelegt);
  const neu = ansicht.zutaten.find((z) => z.id === id)!;
  assert.deepEqual([neu.einheitenart, neu.angabenOffen], ['stueck', true]);

  // Another change leaves it alone: it was never used, so it waits for its first line
  const gericht = await call(t, EssensplanungGerichte, 'POST', 'planung/gerichte', {
    token,
    body: { name: 'Pudding', personen: 4 },
  });
  assert.ok(json<{ ansicht: PlanungAnsicht }>(gericht).ansicht.zutaten.some((z) => z.id === id));

  // Setting its details clears the mark
  const kategorie = (
    await getDb().selectFrom('essen.kategorie').select('id').executeTakeFirstOrThrow()
  ).id;
  const geaendert = await call(t, EssensplanungZutat, 'PATCH', `planung/zutaten/${id}`, {
    token,
    params: { id: String(id) },
    body: { etag: neu.etag, name: 'Vanillepaste', kategorieId: kategorie, einheitenart: 'masse' },
  });
  assert.equal(geaendert.status, 200, JSON.stringify(geaendert.jsonBody));
  const danach = json<PlanungAnsicht>(geaendert).zutaten.find((z) => z.id === id)!;
  assert.deepEqual(
    [danach.kategorieId, danach.einheitenart, danach.angabenOffen],
    [kategorie, 'masse', false]
  );
});
