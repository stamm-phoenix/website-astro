import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import * as endpoints from '../endpoints/essensplanung';
import { getDb } from '../lib/db';
import {
  seedPreviewEssensplanungEinplanung,
  seedPreviewEssensplanungGerichte,
  seedPreviewEssensplanungPlanung,
} from '../lib/db-preview';
import { gerichtStand } from '../lib/essen-gerichte-model';
import { planungLoeschen, ladeZugang } from '../lib/essen-planung';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import { mahlzeitStand, tagStand } from '../lib/essen-planung-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, json } from './fixtures/essensplanung';

async function gericht(t: TestContext, token: string, name: string): Promise<number> {
  const antwort = await call(t, endpoints.EssensplanungGerichte, 'POST', 'planung/gerichte', {
    token,
    body: { name, personen: 10 },
  });
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  return json<{ id: number }>(antwort).id;
}

function einplanen(t: TestContext, token: string, body: object) {
  return call(t, endpoints.EssensplanungEinplanungen, 'POST', 'planung/einplanungen', {
    token,
    body,
  });
}

function aendern(t: TestContext, token: string, id: number, body: object) {
  return call(t, endpoints.EssensplanungEinplanung, 'PATCH', `planung/einplanungen/${id}`, {
    token,
    params: { id: String(id) },
    body,
  });
}

dbTest('dishes are planned at meals with factor and who is responsible', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const chili = await gericht(t, token, 'Chili');
  const pudding = await gericht(t, token, 'Pudding');
  const [mittag, abend] = ansicht.tage[0].mahlzeiten.slice(1, 3);
  const ich = ansicht.mitglieder.find((mitglied) => mitglied.ich)!;

  assert.equal(
    (await einplanen(t, token, { mahlzeitId: mittag.id, gerichtId: chili, zustaendigId: ich.id }))
      .status,
    201
  );
  // Dessert first, for half of them, with a free name
  const beide = json<PlanungAnsicht>(
    await einplanen(t, token, {
      mahlzeitId: mittag.id,
      gerichtId: pudding,
      faktor: '0,5',
      zustaendigText: 'Küchenteam',
      position: 1,
    })
  );
  const geplant = beide.tage[0].mahlzeiten.find((m) => m.id === mittag.id)!.einplanungen;
  assert.deepEqual(
    geplant.map((e) => [e.position, e.gerichtId, e.faktor, e.zustaendigId, e.zustaendig]),
    [
      [1, pudding, 0.5, null, 'Küchenteam'],
      [2, chili, 1, ich.id, ich.name],
    ]
  );

  // Wrong input
  const falsch = async (body: object, feld: string) => {
    const antwort = await einplanen(t, token, { mahlzeitId: mittag.id, gerichtId: chili, ...body });
    assert.equal(antwort.status, 400, JSON.stringify(body));
    assert.ok(json<{ fields: Record<string, string> }>(antwort).fields[feld], feld);
  };
  await falsch({ faktor: 0 }, 'faktor');
  await falsch({ faktor: 21 }, 'faktor');
  await falsch({ faktor: 'zwei' }, 'faktor');
  await falsch({ faktor: 0.0000000001 }, 'faktor');
  await falsch({ faktor: 0.0005 }, 'faktor');
  assert.equal(
    (
      await einplanen(t, token, {
        mahlzeitId: ansicht.tage[1].mahlzeiten[0].id,
        gerichtId: chili,
        faktor: 0.001,
      })
    ).status,
    201
  );
  await falsch({ zustaendigId: ich.id, zustaendigText: 'Kim' }, 'zustaendigText');
  await falsch({ zustaendigId: 999_999 }, 'zustaendigId');
  await falsch({ mahlzeitId: 999_999 }, 'mahlzeitId');
  await falsch({ gerichtId: 999_999 }, 'gerichtId');
  // Another Planung's dish is not this one's
  const andere = await anlegen(t, mails);
  const fremd = await gericht(t, andere.token, 'Fremd');
  await falsch({ gerichtId: fremd }, 'gerichtId');

  // Moving to the evening closes the gap at noon; a stale version is a conflict
  const [puddingGeplant, chiliGeplant] = geplant;
  const verschoben = json<PlanungAnsicht>(
    await aendern(t, token, puddingGeplant.id, {
      etag: puddingGeplant.etag,
      mahlzeitId: abend.id,
      gerichtId: pudding,
      faktor: 0.5,
      zustaendigId: null,
      zustaendigText: '',
    })
  );
  const tag = verschoben.tage[0];
  assert.deepEqual(
    tag.mahlzeiten.find((m) => m.id === mittag.id)!.einplanungen.map((e) => [e.id, e.position]),
    [[chiliGeplant.id, 1]]
  );
  assert.deepEqual(
    tag.mahlzeiten.find((m) => m.id === abend.id)!.einplanungen.map((e) => e.zustaendig),
    ['']
  );
  const alt = await aendern(t, token, puddingGeplant.id, {
    etag: puddingGeplant.etag,
    mahlzeitId: mittag.id,
    gerichtId: pudding,
  });
  assert.equal(alt.status, 409);
  assert.equal(verschoben.aenderungen[0].aktion, 'einplanung-geaendert');
  assert.equal(verschoben.aenderungen[0].details.verschoben, true);

  // Taking it off the meal keeps the dish
  const weg = tag.mahlzeiten.find((m) => m.id === abend.id)!.einplanungen[0];
  const ohne = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungEinplanung, 'DELETE', `planung/einplanungen/${weg.id}`, {
      token,
      params: { id: String(weg.id) },
      ifMatch: weg.etag,
    })
  );
  assert.equal(ohne.tage[0].mahlzeiten.find((m) => m.id === abend.id)!.einplanungen.length, 0);
  assert.equal(ohne.gerichte.length, 2);
});

dbTest('deleting a dish, meal or day covers what is planned there', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const chili = await gericht(t, token, 'Chili');
  const [fruehstueck, mittag] = ansicht.tage[0].mahlzeiten;
  const vorher = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  await einplanen(t, token, { mahlzeitId: mittag.id, gerichtId: chili });
  const jetzt = json<PlanungAnsicht>(
    await einplanen(t, token, { mahlzeitId: fruehstueck.id, gerichtId: chili })
  );

  // The meal: planned after the question was asked
  const mittagVorher = vorher.tage[0].mahlzeiten.find((m) => m.id === mittag.id)!;
  const mittagJetzt = jetzt.tage[0].mahlzeiten.find((m) => m.id === mittag.id)!;
  const loescheMahlzeit = (ifMatch: string) =>
    call(t, endpoints.EssensplanungMahlzeit, 'DELETE', `planung/mahlzeiten/${mittag.id}`, {
      token,
      params: { id: String(mittag.id) },
      ifMatch,
    });
  assert.equal((await loescheMahlzeit(mahlzeitStand(mittagVorher))).status, 409);
  assert.equal((await loescheMahlzeit(mahlzeitStand(mittagJetzt))).status, 200);

  // The dish: with its places in the plan
  const mitPlatz = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  const plaetze = mitPlatz.tage.flatMap((tag) =>
    tag.mahlzeiten.flatMap((m) => m.einplanungen.filter((e) => e.gerichtId === chili))
  );
  assert.equal(plaetze.length, 1);
  const loescheGericht = (ifMatch: string) =>
    call(t, endpoints.EssensplanungGericht, 'DELETE', `planung/gerichte/${chili}`, {
      token,
      params: { id: String(chili) },
      ifMatch,
    });
  const daten = mitPlatz.gerichte[0];
  assert.equal((await loescheGericht(gerichtStand(daten))).status, 409);
  const ohneGericht = json<PlanungAnsicht>(
    await loescheGericht(
      gerichtStand(
        daten,
        plaetze.map((e) => e.etag)
      )
    )
  );
  assert.equal(ohneGericht.gerichte.length, 0);
  assert.ok(ohneGericht.tage.every((tag) => tag.mahlzeiten.every((m) => !m.einplanungen.length)));

  // The day: a dish planned at one of its meals meanwhile
  const pudding = await gericht(t, token, 'Pudding');
  const tagVorher = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  ).tage[1];
  const tagJetzt = json<PlanungAnsicht>(
    await einplanen(t, token, { mahlzeitId: tagVorher.mahlzeiten[0].id, gerichtId: pudding })
  ).tage[1];
  const loescheTag = (ifMatch: string) =>
    call(t, endpoints.EssensplanungTag, 'DELETE', `planung/tage/${tagVorher.id}`, {
      token,
      params: { id: String(tagVorher.id) },
      ifMatch,
    });
  assert.equal((await loescheTag(tagStand(tagVorher))).status, 409);
  assert.equal((await loescheTag(tagStand(tagJetzt))).status, 200);

  // The whole Planung goes with planned dishes and members responsible
  const ich = ansicht.mitglieder.find((mitglied) => mitglied.ich)!;
  await einplanen(t, token, {
    mahlzeitId: ansicht.tage[2].mahlzeiten[0].id,
    gerichtId: pudding,
    zustaendigId: ich.id,
  });
  await planungLoeschen(await ladeZugang(token));
  const rest = await getDb()
    .selectFrom('essen.gericht')
    .select('id')
    .where('id', '=', pudding)
    .executeTakeFirst();
  assert.equal(rest, undefined);
});

dbTest('the preview plans its test dish once', async () => {
  await seedPreviewEssensplanungPlanung();
  await seedPreviewEssensplanungGerichte();
  await seedPreviewEssensplanungEinplanung();
  await seedPreviewEssensplanungEinplanung();
  const geplant = await getDb()
    .selectFrom('essen.einplanung as e')
    .innerJoin('essen.gericht as g', 'g.id', 'e.gericht_id')
    .select('e.id')
    .where('g.name', '=', 'Chili sin Carne (Test)')
    .execute();
  assert.equal(geplant.length, 1);
});

dbTest('a member without access stays responsible; deleting a dish closes the gap', async (t) => {
  const mails = captureMails(t);
  const { token, ansicht } = await anlegen(t, mails);
  const [a, b, c] = [
    await gericht(t, token, 'A'),
    await gericht(t, token, 'B'),
    await gericht(t, token, 'C'),
  ];
  const mahlzeit = ansicht.tage[0].mahlzeiten[0];
  const { id: ben } = await getDb()
    .insertInto('essen.mitglied')
    .values({ planung_id: ansicht.id, name: 'Ben Bezirk', rolle: 'bearbeiten' })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  await einplanen(t, token, { mahlzeitId: mahlzeit.id, gerichtId: a });
  await einplanen(t, token, { mahlzeitId: mahlzeit.id, gerichtId: b });
  const drei = json<PlanungAnsicht>(
    await einplanen(t, token, { mahlzeitId: mahlzeit.id, gerichtId: c, zustaendigId: ben })
  );

  // Ben loses access: C can still be changed and moved, but Ben is not chosen anew
  await getDb()
    .updateTable('essen.mitglied')
    .set({ entzogen_am: new Date() })
    .where('id', '=', ben)
    .execute();
  const cGeplant = drei.tage[0].mahlzeiten[0].einplanungen[2];
  assert.equal(cGeplant.zustaendig, 'Ben Bezirk');
  const geaendert = await aendern(t, token, cGeplant.id, {
    etag: cGeplant.etag,
    mahlzeitId: mahlzeit.id,
    gerichtId: c,
    faktor: 2,
    zustaendigId: ben,
  });
  assert.equal(geaendert.status, 200, JSON.stringify(geaendert.jsonBody));
  const neu = await einplanen(t, token, {
    mahlzeitId: mahlzeit.id,
    gerichtId: a,
    zustaendigId: ben,
  });
  assert.equal(neu.status, 400);

  // Deleting B: C moves up to 2
  const vorher = json<PlanungAnsicht>(geaendert);
  const bDaten = vorher.gerichte.find((g) => g.id === b)!;
  const bPlaetze = vorher.tage[0].mahlzeiten[0].einplanungen.filter((e) => e.gerichtId === b);
  const ohneB = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungGericht, 'DELETE', `planung/gerichte/${b}`, {
      token,
      params: { id: String(b) },
      ifMatch: gerichtStand(
        bDaten,
        bPlaetze.map((e) => e.etag)
      ),
    })
  );
  assert.deepEqual(
    ohneB.tage[0].mahlzeiten[0].einplanungen.map((e) => [e.gerichtId, e.position]),
    [
      [a, 1],
      [c, 2],
    ]
  );
});
