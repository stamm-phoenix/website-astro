import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import * as einkauf from '../endpoints/essensplanung-einkauf';
import * as endpoints from '../endpoints/essensplanung';
import { getDb } from '../lib/db';
import { seedPreviewEssensplanungEinkauf } from '../lib/db-preview-essen-einkauf';
import {
  seedPreviewEssensplanung,
  seedPreviewEssensplanungGerichte,
  seedPreviewEssensplanungPlanung,
} from '../lib/db-preview';
import { ladeZugang, planungLoeschen } from '../lib/essen-planung';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

async function zentral(name: string): Promise<number> {
  return (
    await getDb()
      .selectFrom('essen.zutat')
      .select('id')
      .where('name', '=', name)
      .executeTakeFirstOrThrow()
  ).id;
}

function senden(
  t: TestContext,
  endpoint: Parameters<typeof call>[1],
  method: string,
  path: string,
  token: string,
  body?: object,
  id?: number,
  ifMatch?: string
) {
  return call(t, endpoint, method, path, {
    token,
    body,
    ...(id === undefined ? {} : { params: { id: String(id) } }),
    ...(ifMatch ? { ifMatch } : {}),
  });
}

dbTest('shops are named once per Planung and ingredients are bought at one', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const neu = (name: string) =>
    senden(t, einkauf.EssensplanungGeschaefte, 'POST', 'planung/geschaefte', token, { name });
  assert.equal((await neu('Metro')).status, 201);
  assert.equal((await neu('metro')).status, 400);
  assert.deepEqual(json<{ fields: Record<string, string> }>(await neu('')).fields, {
    name: 'Bitte einen Namen eintragen.',
  });
  const mitBaecker = json<PlanungAnsicht>(await neu('Bäckerei'));
  assert.deepEqual(
    mitBaecker.geschaefte.map((g) => g.name),
    ['Metro', 'Bäckerei']
  );
  const [metro, baecker] = mitBaecker.geschaefte;

  // Stock of a central ingredient makes it one of the Planung, which is then bought at Metro
  const salz = await zentral('Salz');
  const bestand = json<PlanungAnsicht>(
    await senden(t, einkauf.EssensplanungBestandListe, 'POST', 'planung/bestand', token, {
      zutatId: salz,
      menge: 1.5,
      einheit: 'kg',
      hinweis: 'im Schrank',
    })
  );
  const salzDerPlanung = bestand.zutaten.find((z) => z.zutatId === salz)!;
  assert.equal(salzDerPlanung.geschaeftId, null);
  assert.equal(salzDerPlanung.zeilen, 1);
  const zugeordnet = json<PlanungAnsicht>(
    await senden(
      t,
      einkauf.EssensplanungZutatGeschaeft,
      'PUT',
      `planung/zutaten/${salzDerPlanung.id}/geschaeft`,
      token,
      { geschaeftId: metro.id, etag: salzDerPlanung.etag },
      salzDerPlanung.id
    )
  );
  assert.equal(zugeordnet.zutaten.find((z) => z.id === salzDerPlanung.id)!.geschaeftId, metro.id);
  assert.equal(zugeordnet.aenderungen[0].aktion, 'zutat-geschaeft');
  // Someone choosing on the old version does not overwrite it
  const veraltet = await senden(
    t,
    einkauf.EssensplanungZutatGeschaeft,
    'PUT',
    `planung/zutaten/${salzDerPlanung.id}/geschaeft`,
    token,
    { geschaeftId: baecker.id, etag: salzDerPlanung.etag },
    salzDerPlanung.id
  );
  assert.equal(veraltet.status, 409);

  // Renaming keeps it; deleting the shop leaves the salt without one
  const umbenannt = json<PlanungAnsicht>(
    await senden(
      t,
      einkauf.EssensplanungGeschaeft,
      'PATCH',
      `planung/geschaefte/${metro.id}`,
      token,
      { name: 'Großmarkt', etag: metro.etag },
      metro.id
    )
  );
  const grossmarkt = umbenannt.geschaefte.find((g) => g.id === metro.id)!;
  assert.equal(grossmarkt.name, 'Großmarkt');
  const alt = await senden(
    t,
    einkauf.EssensplanungGeschaeft,
    'DELETE',
    `planung/geschaefte/${metro.id}`,
    token,
    undefined,
    metro.id,
    metro.etag
  );
  assert.equal(alt.status, 409);
  const ohne = json<PlanungAnsicht>(
    await senden(
      t,
      einkauf.EssensplanungGeschaeft,
      'DELETE',
      `planung/geschaefte/${metro.id}`,
      token,
      undefined,
      metro.id,
      grossmarkt.etag
    )
  );
  assert.deepEqual(
    ohne.geschaefte.map((g) => g.id),
    [baecker.id]
  );
  assert.equal(ohne.zutaten.find((z) => z.id === salzDerPlanung.id)!.geschaeftId, null);

  // A shop of another Planung is no choice
  const fremd = await senden(
    t,
    einkauf.EssensplanungZutatGeschaeft,
    'PUT',
    `planung/zutaten/${salzDerPlanung.id}/geschaeft`,
    token,
    { geschaeftId: metro.id, etag: ohne.zutaten.find((z) => z.id === salzDerPlanung.id)!.etag },
    salzDerPlanung.id
  );
  assert.equal(fremd.status, 400);
});

dbTest('stock and extra needs take any ingredient in its unit', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const salz = await zentral('Salz');
  const spuelmittel = await zentral('Spülmittel');
  const bestandNeu = (body: object) =>
    senden(t, einkauf.EssensplanungBestandListe, 'POST', 'planung/bestand', token, body);

  // Salt is weighed; the unit and the amount must fit
  const falsch = await bestandNeu({ zutatId: salz, menge: 2, einheit: 'stueck' });
  assert.deepEqual(json<{ fields: Record<string, string> }>(falsch).fields, {
    einheit: 'Salz wird in g oder kg gemessen.',
  });
  assert.deepEqual(
    json<{ fields: Record<string, string> }>(await bestandNeu({ einheit: 'g' })).fields,
    {
      zutat: 'Bitte eine Zutat wählen.',
      menge: 'Bitte eine Menge größer 0 eintragen, z. B. 2,5.',
    }
  );
  const mitSalz = json<PlanungAnsicht>(
    await bestandNeu({ zutatId: salz, menge: 500, einheit: 'g' })
  );
  const [salzBestand] = mitSalz.bestand;
  assert.equal(salzBestand.menge, 500);

  // Dish soap is no food, but extra needs take it
  const zusatz = json<PlanungAnsicht>(
    await senden(t, einkauf.EssensplanungZusatzbedarfListe, 'POST', 'planung/zusatzbedarf', token, {
      zutatId: spuelmittel,
      menge: 3,
      einheit: 'stueck',
      hinweis: 'für die Spülstraße',
    })
  );
  assert.deepEqual(
    zusatz.zusatzbedarf.map(({ menge, einheit, hinweis }) => ({ menge, einheit, hinweis })),
    [{ menge: 3, einheit: 'stueck', hinweis: 'für die Spülstraße' }]
  );
  assert.equal(zusatz.aenderungen[0].aktion, 'zusatzbedarf-neu');

  // An ingredient in use cannot change its kind of unit nor go
  const salzDerPlanung = zusatz.zutaten.find((z) => z.zutatId === salz)!;
  const art = await call(
    t,
    endpoints.EssensplanungZutat,
    'PATCH',
    `planung/zutaten/${salzDerPlanung.id}`,
    {
      token,
      params: { id: String(salzDerPlanung.id) },
      body: { etag: salzDerPlanung.etag, kategorieId: null, einheitenart: 'stueck' },
    }
  );
  assert.equal(art.status, 400);
  assert.match(json<{ fields: Record<string, string> }>(art).fields.einheitenart, /Bestand/);
  const weg = await call(
    t,
    endpoints.EssensplanungZutat,
    'DELETE',
    `planung/zutaten/${salzDerPlanung.id}`,
    {
      token,
      params: { id: String(salzDerPlanung.id) },
      ifMatch: salzDerPlanung.etag,
    }
  );
  assert.equal(weg.status, 400);

  // Changing an entry with an old version is a conflict; with the current one it goes
  const geaendert = json<PlanungAnsicht>(
    await senden(
      t,
      einkauf.EssensplanungBestand,
      'PATCH',
      `planung/bestand/${salzBestand.id}`,
      token,
      { planungZutatId: salzDerPlanung.id, menge: 2, einheit: 'kg', etag: salzBestand.etag },
      salzBestand.id
    )
  );
  assert.equal(geaendert.bestand[0].menge, 2);
  const konflikt = await senden(
    t,
    einkauf.EssensplanungBestand,
    'DELETE',
    `planung/bestand/${salzBestand.id}`,
    token,
    undefined,
    salzBestand.id,
    salzBestand.etag
  );
  assert.equal(konflikt.status, 409);
  const leer = json<PlanungAnsicht>(
    await senden(
      t,
      einkauf.EssensplanungBestand,
      'DELETE',
      `planung/bestand/${salzBestand.id}`,
      token,
      undefined,
      salzBestand.id,
      geaendert.bestand[0].etag
    )
  );
  assert.equal(leer.bestand.length, 0);

  // The whole Planung goes with its shops, stock and extra needs
  await senden(t, einkauf.EssensplanungGeschaefte, 'POST', 'planung/geschaefte', token, {
    name: 'Metro',
  });
  const planungId = (await ladeZugang(token)).planungId;
  await planungLoeschen(await ladeZugang(token));
  for (const tabelle of ['essen.geschaeft', 'essen.zusatzbedarf', 'essen.planung_zutat'] as const) {
    const rest = await getDb()
      .selectFrom(tabelle)
      .select('id')
      .where('planung_id', '=', planungId)
      .executeTakeFirst();
    assert.equal(rest, undefined, tabelle);
  }
});

dbTest('the preview gets invented shops, stock and extra needs once', async () => {
  await seedPreviewEssensplanung();
  await seedPreviewEssensplanungPlanung();
  await seedPreviewEssensplanungGerichte();
  await seedPreviewEssensplanungEinkauf();
  await seedPreviewEssensplanungEinkauf();
  const planung = await getDb()
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .executeTakeFirstOrThrow();
  const anzahl = async (tabelle: 'essen.geschaeft' | 'essen.bestand' | 'essen.zusatzbedarf') =>
    (await getDb().selectFrom(tabelle).select('id').where('planung_id', '=', planung.id).execute())
      .length;
  assert.equal(await anzahl('essen.geschaeft'), 2);
  assert.equal(await anzahl('essen.bestand'), 1);
  assert.equal(await anzahl('essen.zusatzbedarf'), 2);
  const ohneGeschaeft = await getDb()
    .selectFrom('essen.planung_zutat')
    .select('id')
    .where('planung_id', '=', planung.id)
    .where('geschaeft_id', 'is', null)
    .execute();
  assert.equal(ohneGeschaeft.length, 0);
});
