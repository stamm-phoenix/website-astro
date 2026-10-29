import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import * as endpoints from '../endpoints/essensplanung';
import { EssensplanungListeEintragEndpoint } from '../endpoints/intern-essensplanung-steuerung';
import { getDb, toVersion } from '../lib/db';
import {
  seedPreviewEssensplanungGerichte,
  seedPreviewEssensplanungPlanung,
} from '../lib/db-preview';
import { loadEssenSteuerung, updateZutat } from '../lib/essen-steuerung';
import type { ZutatInput } from '../lib/essen-validation';
import { ValidationError } from '../lib/pflege-validation';
import type { EssenKatalog } from '../lib/essen-gerichte-model';
import { gerichtWarnungen } from '../lib/essen-gerichte-model';
import { planungLoeschen, ladeZugang } from '../lib/essen-planung';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, context, json } from './fixtures/essensplanung';

async function zentraleZutat(name: string): Promise<number> {
  const row = await getDb()
    .selectFrom('essen.zutat')
    .select('id')
    .where('name', '=', name)
    .executeTakeFirstOrThrow();
  return row.id;
}

async function unvertraeglichkeit(schluessel: string): Promise<number> {
  const row = await getDb()
    .selectFrom('essen.unvertraeglichkeit')
    .select('id')
    .where('schluessel', '=', schluessel)
    .executeTakeFirstOrThrow();
  return row.id;
}

async function gerichtMitId(
  t: TestContext,
  token: string,
  body: Record<string, unknown>
): Promise<{ id: number; ansicht: PlanungAnsicht }> {
  const antwort = await call(t, endpoints.EssensplanungGerichte, 'POST', 'planung/gerichte', {
    token,
    body,
  });
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  return json<{ id: number; ansicht: PlanungAnsicht }>(antwort);
}

function zeileHinzufuegen(t: TestContext, token: string, gerichtId: number, body: object) {
  return call(
    t,
    endpoints.EssensplanungGerichtZutaten,
    'POST',
    `planung/gerichte/${gerichtId}/zutaten`,
    {
      token,
      params: { id: String(gerichtId) },
      body,
    }
  );
}

dbTest('dishes get lines from the central list in the unit of the ingredient', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const katalog = json<EssenKatalog>(
    await call(t, endpoints.EssensplanungKatalog, 'GET', 'planung/katalog', { token })
  );
  assert.ok(katalog.zutaten.length > 400);
  assert.equal(katalog.unvertraeglichkeiten.filter((u) => u.schluessel).length, 14);

  const { id } = await gerichtMitId(t, token, { name: 'Chili', personen: 10 });
  const doppelt = await call(t, endpoints.EssensplanungGerichte, 'POST', 'planung/gerichte', {
    token,
    body: { name: 'chili', personen: 4 },
  });
  assert.equal(doppelt.status, 400);
  assert.match(json<{ fields: { name: string } }>(doppelt).fields.name, /gibt es/);

  const hack = await zentraleZutat('Hackfleisch');
  const milch = await zentraleZutat('H-Milch');
  const gluten = await unvertraeglichkeit('gluten');
  assert.equal(
    (
      await zeileHinzufuegen(t, token, id, {
        zutatId: hack,
        menge: 1.5,
        einheit: 'kg',
        fuerVegetarisch: false,
        fuerVegan: false,
      })
    ).status,
    201
  );
  // Milk is measured in ml or l, never in grams
  const falsch = await zeileHinzufuegen(t, token, id, { zutatId: milch, menge: 200, einheit: 'g' });
  assert.equal(falsch.status, 400);
  assert.match(json<{ fields: { einheit: string } }>(falsch).fields.einheit, /ml oder l/);
  // Things that are not food belong to no dish
  const alufolie = await zeileHinzufuegen(t, token, id, {
    zutatId: await zentraleZutat('Alufolie'),
    menge: 1,
    einheit: 'stueck',
  });
  assert.equal(alufolie.status, 400);
  // Without an amount, at the top, and not for gluten
  const ansicht = json<PlanungAnsicht>(
    await zeileHinzufuegen(t, token, id, {
      zutatId: hack,
      hinweis: 'eine Handvoll extra',
      fuerVegan: false,
      ohne: [gluten],
      position: 1,
    })
  );
  const gericht = ansicht.gerichte.find((g) => g.id === id)!;
  assert.deepEqual(
    gericht.zutaten.map((z) => [z.position, z.menge, z.einheit, z.hinweis, z.ohne]),
    [
      [1, null, null, 'eine Handvoll extra', [gluten]],
      [2, 1.5, 'kg', '', []],
    ]
  );
  // The central ingredient became one ingredient of the Planung, used twice
  assert.equal(ansicht.zutaten.length, 1);
  assert.equal(ansicht.zutaten[0].zutatId, hack);
  assert.equal(ansicht.zutaten[0].zeilen, 2);
  assert.equal(ansicht.zutaten[0].vegetarisch, false);

  // Meat for vegetarians and nothing for vegans are warned about
  const zutaten = new Map(ansicht.zutaten.map((z) => [z.id, z]));
  assert.deepEqual(
    gerichtWarnungen(gericht, zutaten).map((w) => w.text),
    [
      'Hackfleisch ist nicht vegetarisch, die Zeile gilt aber für vegetarisch Essende.',
      'Für vegan Essende gibt es in diesem Gericht keine Zutat.',
    ]
  );

  // A line changes as a whole and moves; an old version conflicts
  const zweite = gericht.zutaten[1];
  const geaendert = await call(
    t,
    endpoints.EssensplanungGerichtZutat,
    'PATCH',
    `planung/gericht-zutaten/${zweite.id}`,
    {
      token,
      params: { id: String(zweite.id) },
      body: {
        etag: zweite.etag,
        zutatId: hack,
        menge: 800,
        einheit: 'g',
        fest: true,
        fuerVegetarisch: false,
        fuerVegan: false,
        position: 1,
      },
    }
  );
  assert.equal(geaendert.status, 200, JSON.stringify(geaendert.jsonBody));
  const nachher = json<PlanungAnsicht>(geaendert).gerichte[0].zutaten;
  assert.deepEqual(
    nachher.map((z) => [z.position, z.menge, z.einheit, z.fest]),
    [
      [1, 800, 'g', true],
      [2, null, null, false],
    ]
  );
  const veraltet = await call(
    t,
    endpoints.EssensplanungGerichtZutat,
    'PATCH',
    `planung/gericht-zutaten/${zweite.id}`,
    {
      token,
      params: { id: String(zweite.id) },
      body: { etag: zweite.etag, zutatId: hack, menge: 1, einheit: 'kg' },
    }
  );
  assert.equal(veraltet.status, 409);

  // Deleting a line closes the gap
  const weg = nachher[0];
  const geloescht = json<PlanungAnsicht>(
    await call(
      t,
      endpoints.EssensplanungGerichtZutat,
      'DELETE',
      `planung/gericht-zutaten/${weg.id}`,
      {
        token,
        params: { id: String(weg.id) },
        ifMatch: weg.etag,
      }
    )
  );
  assert.deepEqual(
    geloescht.gerichte[0].zutaten.map((z) => z.position),
    [1]
  );
  assert.equal(geloescht.aenderungen[0].aktion, 'gericht-zutat-geloescht');
});

dbTest('the dish itself changes with its version; tools and links are checked', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const { id, ansicht } = await gerichtMitId(t, token, { name: 'Pudding', personen: 20 });
  const etag = ansicht.gerichte[0].etag;
  const ungueltig = await call(
    t,
    endpoints.EssensplanungGericht,
    'PATCH',
    `planung/gerichte/${id}`,
    {
      token,
      params: { id: String(id) },
      body: { etag, links: [{ titel: 'Rezept', url: 'javascript:alert(1)' }] },
    }
  );
  assert.equal(ungueltig.status, 400);
  // A too long tool name shows at the field of the tools
  const zuLang = await call(t, endpoints.EssensplanungGericht, 'PATCH', `planung/gerichte/${id}`, {
    token,
    params: { id: String(id) },
    body: { etag, werkzeuge: ['x'.repeat(101)] },
  });
  assert.equal(zuLang.status, 400);
  assert.ok(json<{ fields: { werkzeuge: string } }>(zuLang).fields.werkzeuge);
  const gespeichert = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungGericht, 'PATCH', `planung/gerichte/${id}`, {
      token,
      params: { id: String(id) },
      body: {
        etag,
        anleitung: 'Milch aufkochen.',
        werkzeuge: ['Schneebesen', ' schneebesen ', 'Großer Topf'],
        links: [{ titel: 'Rezept', url: 'https://example.org/pudding' }],
      },
    })
  );
  const gericht = gespeichert.gerichte[0];
  assert.equal(gericht.name, 'Pudding');
  assert.equal(gericht.anleitung, 'Milch aufkochen.');
  assert.deepEqual(gericht.werkzeuge, ['Schneebesen', 'Großer Topf']);
  assert.deepEqual(gericht.links, [{ titel: 'Rezept', url: 'https://example.org/pudding' }]);
  const konflikt = await call(
    t,
    endpoints.EssensplanungGericht,
    'PATCH',
    `planung/gerichte/${id}`,
    {
      token,
      params: { id: String(id) },
      body: { etag, personen: 30 },
    }
  );
  assert.equal(konflikt.status, 409);
  assert.equal(json<{ ansicht: PlanungAnsicht }>(konflikt).ansicht.gerichte[0].personen, 20);

  // Deleting the dish takes its lines along
  await zeileHinzufuegen(t, token, id, {
    zutatId: await zentraleZutat('H-Milch'),
    menge: 1,
    einheit: 'l',
  });
  const vorLoeschen = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  const geloescht = await call(
    t,
    endpoints.EssensplanungGericht,
    'DELETE',
    `planung/gerichte/${id}`,
    {
      token,
      params: { id: String(id) },
      ifMatch: vorLoeschen.gerichte[0].etag,
    }
  );
  assert.equal(geloescht.status, 200);
  assert.equal(json<PlanungAnsicht>(geloescht).gerichte.length, 0);
});

dbTest('own ingredients and differences stay in their Planung', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const kategorie = (
    await getDb().selectFrom('essen.kategorie').select('id').executeTakeFirstOrThrow()
  ).id;
  const nuss = await unvertraeglichkeit('schalenfruechte');
  const schonDa = await call(t, endpoints.EssensplanungZutaten, 'POST', 'planung/zutaten', {
    token,
    body: { name: 'Hackfleisch', kategorieId: kategorie, einheitenart: 'masse' },
  });
  assert.equal(schonDa.status, 400);
  const angelegt = await call(t, endpoints.EssensplanungZutaten, 'POST', 'planung/zutaten', {
    token,
    body: {
      name: 'Omas Nussmischung',
      kategorieId: kategorie,
      einheitenart: 'masse',
      vegan: true,
      allergene: [nuss],
    },
  });
  assert.equal(angelegt.status, 201, JSON.stringify(angelegt.jsonBody));
  const { id: eigeneId, ansicht } = json<{ id: number; ansicht: PlanungAnsicht }>(angelegt);
  const eigene = ansicht.zutaten.find((z) => z.id === eigeneId)!;
  assert.deepEqual(
    [eigene.zutatId, eigene.vegetarisch, eigene.vegan, eigene.allergene],
    [null, true, true, [nuss]]
  );

  const { id: gerichtId } = await gerichtMitId(t, token, { name: 'Müsli', personen: 1 });
  await zeileHinzufuegen(t, token, gerichtId, {
    planungZutatId: eigeneId,
    menge: 50,
    einheit: 'g',
  });
  const milch = await zentraleZutat('H-Milch');
  const mitMilch = json<PlanungAnsicht>(
    await zeileHinzufuegen(t, token, gerichtId, { zutatId: milch, menge: 200, einheit: 'ml' })
  );
  const milchDerPlanung = mitMilch.zutaten.find((z) => z.zutatId === milch)!;

  // Used ingredients stay; the kind of unit stays while lines measure in it
  const nichtLoeschbar = await call(
    t,
    endpoints.EssensplanungZutat,
    'DELETE',
    `planung/zutaten/${eigeneId}`,
    {
      token,
      params: { id: String(eigeneId) },
      ifMatch: mitMilch.zutaten.find((z) => z.id === eigeneId)!.etag,
    }
  );
  assert.equal(nichtLoeschbar.status, 400);
  const andereArt = await call(
    t,
    endpoints.EssensplanungZutat,
    'PATCH',
    `planung/zutaten/${milchDerPlanung.id}`,
    {
      token,
      params: { id: String(milchDerPlanung.id) },
      body: { etag: milchDerPlanung.etag, kategorieId: null, einheitenart: 'packung' },
    }
  );
  assert.equal(andereArt.status, 400);
  const andereKategorie = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungZutat, 'PATCH', `planung/zutaten/${milchDerPlanung.id}`, {
      token,
      params: { id: String(milchDerPlanung.id) },
      body: { etag: milchDerPlanung.etag, kategorieId: kategorie, einheitenart: null },
    })
  );
  const abweichend = andereKategorie.zutaten.find((z) => z.id === milchDerPlanung.id)!;
  assert.deepEqual(abweichend.abweichend, { kategorie: true, einheitenart: false });
  assert.equal(abweichend.kategorieId, kategorie);

  // The Steuerung keeps a central ingredient that a Planung uses
  const zentral = await getDb()
    .selectFrom('essen.zutat')
    .select('version')
    .where('id', '=', milch)
    .executeTakeFirstOrThrow();
  const admin = new HttpRequest({
    url: `http://localhost/api/intern/pflege/essensplanung/zutaten/${milch}`,
    method: 'DELETE',
    headers: {
      'if-match': toVersion(zentral.version),
      'x-ms-client-principal': Buffer.from(
        JSON.stringify({
          identityProvider: 'aad',
          userId: 'admin',
          userDetails: 'admin@example.test',
          userRoles: ['authenticated', 'team_leitende', 'team_admin'],
        })
      ).toString('base64'),
    },
    params: { liste: 'zutaten', id: String(milch) },
  });
  const steuerung = await EssensplanungListeEintragEndpoint(admin, context(t));
  assert.equal(steuerung.status, 400, JSON.stringify(steuerung.jsonBody));

  // Deleting the Planung removes dishes and ingredients of the Planung
  await planungLoeschen(await ladeZugang(token));
  const rest = await getDb()
    .selectFrom('essen.planung_zutat')
    .select('id')
    .where('id', 'in', [eigeneId, milchDerPlanung.id])
    .execute();
  assert.equal(rest.length, 0);
});

dbTest('the read-only link sees dishes but changes nothing', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  await gerichtMitId(t, token, { name: 'Brot', personen: 1 });
  const links = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungLinks, 'POST', 'planung/links', {
      token,
      body: { art: 'lesen', an: true },
    })
  );
  const lesen = links.links!.lesen!;
  const ansicht = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token: lesen })
  );
  assert.equal(ansicht.gerichte[0].name, 'Brot');
  assert.equal(
    (await call(t, endpoints.EssensplanungKatalog, 'GET', 'planung/katalog', { token: lesen }))
      .status,
    200
  );
  const verboten = await call(t, endpoints.EssensplanungGerichte, 'POST', 'planung/gerichte', {
    token: lesen,
    body: { name: 'Butter', personen: 1 },
  });
  assert.equal(verboten.status, 403);
});

dbTest('previews get one invented dish in the invented Planung', async () => {
  await seedPreviewEssensplanungPlanung(new Date('2027-05-01T10:00:00Z'));
  await seedPreviewEssensplanungGerichte();
  await seedPreviewEssensplanungGerichte();
  const gerichte = await getDb()
    .selectFrom('essen.gericht as g')
    .innerJoin('essen.planung as p', 'p.id', 'g.planung_id')
    .select(['g.id', 'g.name'])
    .where('p.name', '=', 'Sommerlager (Test)')
    .execute();
  assert.deepEqual(
    gerichte.map((g) => g.name),
    ['Chili sin Carne (Test)']
  );
  const zeilen = await getDb()
    .selectFrom('essen.gericht_zutat')
    .select(['menge', 'einheit'])
    .where('gericht_id', '=', gerichte[0].id)
    .orderBy('position')
    .execute();
  assert.deepEqual(
    zeilen.map((z) => [z.menge === null ? null : Number(z.menge), z.einheit]),
    [
      [2, 'kg'],
      [null, null],
    ]
  );
});

dbTest(
  'the Steuerung keeps a kind of unit that dishes measure in; open pages see changes',
  async (t) => {
    const mails = captureMails(t);
    const { token, ansicht } = await anlegen(t, mails);
    const milch = await zentraleZutat('H-Milch');
    const { id } = await gerichtMitId(t, token, { name: 'Kakao', personen: 10 });
    await zeileHinzufuegen(t, token, id, { zutatId: milch, menge: 200, einheit: 'ml' });
    const steuerung = await loadEssenSteuerung();
    const zentral = steuerung.zutaten.find((z) => z.id === milch)!;
    const { etag } = zentral;
    const input: ZutatInput = {
      name: zentral.name,
      kategorieId: zentral.kategorieId,
      einheitenart: zentral.einheitenart,
      abtropfgewicht: zentral.abtropfgewicht,
      lebensmittel: zentral.lebensmittel,
      vegetarisch: zentral.vegetarisch,
      vegan: zentral.vegan,
      merkmaleGeprueft: zentral.merkmaleGeprueft,
      hinweis: zentral.hinweis,
      grammProTl: zentral.grammProTl,
      grammProEl: zentral.grammProEl,
      grammProStueck: zentral.grammProStueck,
      allergene: zentral.allergene,
    };
    await assert.rejects(
      updateZutat(String(milch), { ...input, einheitenart: 'packung' }, etag, 'admin'),
      (error: unknown) => error instanceof ValidationError && Boolean(error.fields.einheitenart)
    );

    // A change of the central lists changes the state the open pages poll
    const vorher = json<PlanungAnsicht>(
      await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
    );
    await updateZutat(String(milch), { ...input, hinweis: 'neu geprüft' }, etag, 'admin');
    const stand = json<{ stand: string; ansicht?: PlanungAnsicht }>(
      await call(t, endpoints.EssensplanungStand, 'GET', 'planung/stand', {
        token,
        query: `?seit=${encodeURIComponent(vorher.stand)}`,
      })
    );
    assert.notEqual(stand.stand, vorher.stand);
    assert.notEqual(stand.ansicht!.katalogStand, ansicht.katalogStand);
  }
);

dbTest('an ingredient marked as not food meanwhile takes no more lines', async (t) => {
  const mails = captureMails(t);
  const { token } = await anlegen(t, mails);
  const milch = await zentraleZutat('H-Milch');
  const { id } = await gerichtMitId(t, token, { name: 'Milchreis', personen: 4 });
  const ansicht = json<PlanungAnsicht>(
    await zeileHinzufuegen(t, token, id, { zutatId: milch, menge: 1, einheit: 'l' })
  );
  const planungZutat = ansicht.zutaten.find((z) => z.zutatId === milch)!;
  await getDb()
    .updateTable('essen.zutat')
    .set({ lebensmittel: false, vegetarisch: null, vegan: null })
    .where('id', '=', milch)
    .execute();
  for (const body of [{ planungZutatId: planungZutat.id }, { zutatId: milch }]) {
    const antwort = await zeileHinzufuegen(t, token, id, { ...body, menge: 1, einheit: 'l' });
    assert.equal(antwort.status, 400);
    assert.match(json<{ fields: { zutat: string } }>(antwort).fields.zutat, /kein Lebensmittel/);
  }
});
