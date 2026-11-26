import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import type { HttpHandler, HttpResponseInit } from '@azure/functions';
import {
  EssensplanungGerichte,
  EssensplanungGerichtZutaten,
} from '../endpoints/essensplanung-gerichte';
import { EssensplanungBestandListe } from '../endpoints/essensplanung-einkauf';
import {
  EssensplanungPlanungsZutaten,
  EssensplanungZutatUebernehmen,
  EssensplanungZutatenZusammenlegen,
} from '../endpoints/intern-essensplanung-zutaten-zentral';
import { getDb } from '../lib/db';
import { ladeAnsicht } from '../lib/essen-ansicht';
import { ladeZugang } from '../lib/essen-zugang';
import type { PlanungAnsicht } from '../lib/essen-planung-model';
import type { PlanungsZutat } from '../lib/essen-zutat-zentral-model';
import { dbTest } from './fixtures/database';
import { anlegen, call, captureMails, context, json } from './fixtures/essensplanung';

/** The central list takes own ingredients of the Planungen over and merges duplicates. */

function intern(
  t: TestContext,
  handler: HttpHandler,
  method: string,
  path: string,
  body?: unknown
): Promise<HttpResponseInit> {
  return handler(
    new HttpRequest({
      url: `http://localhost/api/intern/${path}`,
      method,
      headers: {
        'content-type': 'application/json',
        'x-ms-client-principal': Buffer.from(
          JSON.stringify({
            identityProvider: 'aad',
            userId: 'admin',
            userDetails: 'admin@example.test',
            userRoles: ['authenticated', 'team_leitende', 'team_admin'],
          })
        ).toString('base64'),
      },
      ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
    }),
    context(t)
  ) as Promise<HttpResponseInit>;
}

async function planungMit(t: TestContext, zeilen: object[]): Promise<string> {
  const { token } = await anlegen(t, captureMails(t));
  const gericht = await call(t, EssensplanungGerichte, 'POST', 'planung/gerichte', {
    token,
    body: { name: 'Eintopf', personen: 10 },
  });
  const { id } = json<{ id: number }>(gericht);
  for (const zeile of zeilen) {
    const antwort = await call(
      t,
      EssensplanungGerichtZutaten,
      'POST',
      `planung/gerichte/${id}/zutaten`,
      {
        token,
        params: { id: String(id) },
        body: zeile,
      }
    );
    assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  }
  return token;
}

async function zentral(name: string): Promise<number> {
  return (
    await getDb()
      .selectFrom('essen.zutat')
      .select('id')
      .where('name', '=', name)
      .executeTakeFirstOrThrow()
  ).id;
}

const ansicht = async (token: string): Promise<PlanungAnsicht> =>
  ladeAnsicht(await ladeZugang(token));

dbTest('own ingredients of several Planungen become one new central ingredient', async (t) => {
  const eins = await planungMit(t, [{ neueZutat: 'Omas Eintopfwürze', menge: 10, einheit: 'g' }]);
  const zwei = await planungMit(t, [{ neueZutat: 'omas eintopfwürze', menge: 5, einheit: 'g' }]);
  const liste = await intern(
    t,
    EssensplanungPlanungsZutaten,
    'GET',
    'essensplanung/planungs-zutaten'
  );
  const gruppe = (liste.jsonBody as { zutaten: PlanungsZutat[] }).zutaten.find(
    (z) => z.name.toLowerCase() === 'omas eintopfwürze'
  )!;
  assert.equal(gruppe.ids.length, 2);
  assert.equal(gruppe.angabenOffen, true);

  const kategorie = (
    await getDb().selectFrom('essen.kategorie').select('id').executeTakeFirstOrThrow()
  ).id;
  const antwort = await intern(
    t,
    EssensplanungZutatUebernehmen,
    'POST',
    'pflege/essensplanung-zutaten/uebernehmen',
    {
      name: gruppe.name,
      zutat: {
        name: 'Eintopfwürze',
        kategorieId: kategorie,
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
    }
  );
  assert.equal(antwort.status, 200, JSON.stringify(antwort.jsonBody));
  const { zutatId, planungen, planungsZutaten } = antwort.jsonBody as {
    zutatId: number;
    planungen: number;
    planungsZutaten: PlanungsZutat[];
  };
  assert.equal(planungen, 2);
  assert.ok(!planungsZutaten.some((z) => z.name.toLowerCase() === 'omas eintopfwürze'));
  for (const token of [eins, zwei]) {
    const jetzt = await ansicht(token);
    const zutat = jetzt.zutaten.find((z) => z.zutatId === zutatId)!;
    assert.deepEqual([zutat.name, zutat.angabenOffen, zutat.zeilen], ['Eintopfwürze', false, 1]);
    assert.equal(jetzt.aenderungen[0].aktion, 'zutat-zentral');
  }
});

dbTest(
  'merging two central ingredients moves lines and stock and adds up nothing twice',
  async (t) => {
    const zwiebel = await zentral('Zwiebeln');
    const andere = await zentral('Knoblauch (Zehen)');
    const token = await planungMit(t, [
      { zutatId: zwiebel, menge: 2, einheit: 'kg' },
      { zutatId: andere, menge: 3, einheit: 'Stück' },
    ]);
    const bestand = await call(t, EssensplanungBestandListe, 'POST', 'planung/bestand', {
      token,
      body: { zutatId: andere, menge: 1, einheit: 'Stück', hinweis: '' },
    });
    assert.equal(bestand.status, 201, JSON.stringify(bestand.jsonBody));
    const antwort = await intern(
      t,
      EssensplanungZutatenZusammenlegen,
      'POST',
      'pflege/essensplanung-zutaten/zusammenlegen',
      {
        von: andere,
        nach: zwiebel,
      }
    );
    assert.equal(antwort.status, 200, JSON.stringify(antwort.jsonBody));
    const jetzt = await ansicht(token);
    assert.deepEqual(
      jetzt.zutaten.map((z) => [z.zutatId, z.zeilen]),
      [[zwiebel, 3]]
    );
    assert.equal(jetzt.gerichte[0].zutaten.length, 2);
    const weg = await getDb()
      .selectFrom('essen.zutat')
      .select('id')
      .where('id', '=', andere)
      .executeTakeFirst();
    assert.equal(weg, undefined);
    const gleich = await intern(
      t,
      EssensplanungZutatenZusammenlegen,
      'POST',
      'pflege/essensplanung-zutaten/zusammenlegen',
      {
        von: zwiebel,
        nach: zwiebel,
      }
    );
    assert.equal(gleich.status, 400);
  }
);
