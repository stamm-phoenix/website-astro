import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import type { HttpResponseInit } from '@azure/functions';
import {
  EssensplanungEinstellungen,
  EssensplanungListe,
  EssensplanungListeEintrag,
  EssensplanungSteuerung,
} from '../endpoints/intern-essensplanung-steuerung';
import { getDb } from '../lib/db';
import { seedPreviewEssensplanung } from '../lib/db-preview';
import { buildStartdatenSql, buildUmrechnungSql, readCsv } from '../lib/essen-startdaten';
import type { EssenEinstellungen, EssenSteuerungView, EssenZutat } from '../lib/essen-validation';
import {
  darfPlanungAnlegen,
  validateEssenEinstellungen,
  validateZutat,
} from '../lib/essen-validation';
import { ValidationError } from '../lib/pflege-validation';
import { dbTest } from './fixtures/database';

const MIGRATIONS = resolve(__dirname, '../../migrations');

const ADMIN = ['authenticated', 'team_leitende', 'team_admin'];
const LEITUNG = ['authenticated', 'team_leitende'];

function request(
  method: string,
  url: string,
  options: {
    body?: unknown;
    roles?: string[];
    params?: Record<string, string>;
    ifMatch?: string;
  } = {}
): HttpRequest {
  const principal = {
    identityProvider: 'aad',
    userId: 'test-admin',
    userDetails: 'admin@example.test',
    userRoles: options.roles ?? ADMIN,
  };
  return new HttpRequest({
    url: `http://localhost/api/${url}`,
    method,
    headers: {
      'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
      ...(options.ifMatch ? { 'if-match': options.ifMatch } : {}),
    },
    params: options.params,
    body: options.body === undefined ? undefined : { string: JSON.stringify(options.body) },
  });
}

function context(t: TestContext): InvocationContext {
  const result = new InvocationContext();
  t.mock.method(result, 'log', () => undefined);
  return result;
}

function view(response: HttpResponseInit): EssenSteuerungView {
  return response.jsonBody as EssenSteuerungView;
}

const EINSTELLUNGEN: EssenEinstellungen = {
  anlegenExtern: false,
  whitelist: [],
  aufbewahrungMonate: 12,
  wartung: false,
  vorlageGruppen: [
    { name: 'Wö', faktor: 0.7 },
    { name: 'Jupfi', faktor: 0.8 },
    { name: 'Pfadi', faktor: 1 },
    { name: 'Rover', faktor: 1.2 },
    { name: 'Leitende', faktor: 1.2 },
  ],
  vorlageMahlzeiten: [
    'Frühstück',
    'Mittagessen',
    'Kaffee & Kuchen',
    'Abendessen',
    'Mitternachtssnack',
  ],
};

function zutatInput(patch: Record<string, unknown> = {}) {
  return {
    name: 'Testmehl',
    kategorieId: 1,
    einheitenart: 'masse',
    abtropfgewicht: false,
    lebensmittel: true,
    vegetarisch: true,
    vegan: true,
    merkmaleGeprueft: true,
    hinweis: '',
    grammProTl: null,
    grammProEl: 15,
    grammProStueck: null,
    allergene: [],
    ...patch,
  };
}

function fieldErrors(work: () => unknown): string[] {
  try {
    work();
  } catch (error: unknown) {
    assert.ok(error instanceof ValidationError);
    return Object.keys(error.fields).sort();
  }
  assert.fail('expected a validation error');
}

test('the start data migration is the one built from the CSV files', () => {
  const built = buildStartdatenSql(resolve(MIGRATIONS, 'seed/essensplanung'));
  const stored = readFileSync(resolve(MIGRATIONS, '0050_essensplanung_startdaten.sql'), 'utf8');
  assert.equal(stored, built, 'run `bun scripts/essensplanung-startdaten.ts` in api/');
});

test('the conversion migration is the one built from the CSV file', () => {
  const built = buildUmrechnungSql(resolve(MIGRATIONS, 'seed/essensplanung'));
  const stored = readFileSync(resolve(MIGRATIONS, '0057_essensplanung_umrechnung.sql'), 'utf8');
  assert.equal(stored, built, 'run `bun scripts/essensplanung-umrechnung.ts` in api/');
});

test('the CSV reader handles quotes, commas and empty fields', () => {
  assert.deepEqual(readCsv('a,b,c\n"x, ""y""",,z\n'), [{ a: 'x, "y"', b: '', c: 'z' }]);
  assert.throws(() => readCsv('a,b\n1\n'));
});

test('the settings are validated per field and normalized', () => {
  assert.deepEqual(validateEssenEinstellungen(EINSTELLUNGEN), EINSTELLUNGEN);
  const normalized = validateEssenEinstellungen({
    ...EINSTELLUNGEN,
    whitelist: [' @DPSG-Bezirk.de ', 'Jemand@Example.org', '', 'dpsg-bezirk.de'],
    vorlageGruppen: [{ name: '  Wö  ', faktor: 0.705 }],
  });
  assert.deepEqual(normalized.whitelist, ['dpsg-bezirk.de', 'jemand@example.org']);
  assert.deepEqual(normalized.vorlageGruppen, [{ name: 'Wö', faktor: 0.71 }]);

  assert.deepEqual(
    fieldErrors(() =>
      validateEssenEinstellungen({
        ...EINSTELLUNGEN,
        anlegenExtern: 'ja',
        whitelist: ['kein eintrag'],
        aufbewahrungMonate: 0,
        vorlageGruppen: [
          { name: 'Wö', faktor: 0.001 },
          { name: 'wö', faktor: 1 },
        ],
        vorlageMahlzeiten: [],
      })
    ),
    [
      'anlegenExtern',
      'aufbewahrungMonate',
      'vorlageGruppen.0.faktor',
      'vorlageGruppen.1.name',
      'vorlageMahlzeiten',
      'whitelist.0',
    ]
  );
});

test('the Stamm may always create Planungen, externals only when allowed', () => {
  const aus = { ...EINSTELLUNGEN };
  const an = { ...EINSTELLUNGEN, anlegenExtern: true };
  const liste = { ...an, whitelist: ['dpsg-bezirk.de', 'kueche@example.org'] };
  assert.equal(darfPlanungAnlegen('Leitung@Stamm-Phoenix.de', aus), true);
  assert.equal(darfPlanungAnlegen('jemand@example.org', aus), false);
  assert.equal(darfPlanungAnlegen('jemand@example.org', an), true);
  assert.equal(darfPlanungAnlegen('jemand@dpsg-bezirk.de', liste), true);
  assert.equal(darfPlanungAnlegen('kueche@example.org', liste), true);
  assert.equal(darfPlanungAnlegen('jemand@example.org', liste), false);
  assert.equal(darfPlanungAnlegen('jemand@sub.dpsg-bezirk.de', liste), false);
});

test('ingredients are validated; things that are not eaten have no diet', () => {
  assert.deepEqual(
    fieldErrors(() =>
      validateZutat(
        zutatInput({
          name: ' ',
          kategorieId: 0,
          einheitenart: 'liter',
          abtropfgewicht: true,
          vegetarisch: false,
          vegan: true,
          grammProEl: -1,
          allergene: ['gluten'],
        })
      )
    ),
    ['abtropfgewicht', 'allergene', 'einheitenart', 'grammProEl', 'kategorieId', 'name', 'vegan']
  );
  assert.deepEqual(
    fieldErrors(() =>
      validateZutat(zutatInput({ grammProTl: 0.001, grammProEl: 100_000, grammProStueck: 'x' }))
    ),
    ['grammProEl', 'grammProStueck', 'grammProTl']
  );
  assert.equal(validateZutat(zutatInput({ grammProStueck: 120.456 })).grammProStueck, 120.46);
  const spuelmittel = validateZutat(
    zutatInput({ name: 'Spülmittel', lebensmittel: false, einheitenart: 'stueck', allergene: [3] })
  );
  assert.equal(spuelmittel.vegetarisch, null);
  assert.equal(spuelmittel.vegan, null);
  assert.deepEqual(spuelmittel.allergene, []);
  assert.equal(validateZutat(zutatInput({ vegetarisch: null, vegan: null })).vegan, null);
});

dbTest('the migration brings the start data from the kitchen sheet', async (t) => {
  const response = await EssensplanungSteuerung(
    request('GET', 'intern/essensplanung/steuerung'),
    context(t)
  );
  assert.equal(response.status, 200);
  const data = view(response);
  const csv = readCsv(readFileSync(resolve(MIGRATIONS, 'seed/essensplanung/zutaten.csv'), 'utf8'));
  assert.equal(data.zutaten.length, csv.length);
  assert.equal(data.kategorien.length, 28);
  assert.equal(data.unvertraeglichkeiten.length, 14);
  assert.deepEqual(data.einstellungen, EINSTELLUNGEN);
  assert.ok(data.zutaten.every((zutat) => !zutat.merkmaleGeprueft));

  const byName = (name: string): EssenZutat => data.zutaten.find((zutat) => zutat.name === name)!;
  const gluten = data.unvertraeglichkeiten.find((u) => u.schluessel === 'gluten')!;
  assert.ok(byName('Brot (geschnitten)').allergene.includes(gluten.id));
  assert.equal(byName('Honig').vegetarisch, true);
  assert.equal(byName('Honig').vegan, false);
  assert.equal(byName('Spülmittel').lebensmittel, false);
  assert.equal(byName('Spülmittel').vegan, null);
  assert.equal(byName('Kidneybohnen').abtropfgewicht, true);
  // The conversion helper from the sheet's table
  assert.deepEqual(
    [byName('Butter').grammProTl, byName('Butter').grammProEl, byName('Butter').grammProStueck],
    [5, 15, null]
  );
  assert.equal(byName('Zwiebeln').grammProStueck, 83);
  assert.equal(byName('Cashewnüsse').grammProStueck, 1.5);
  const zuordnung = readCsv(
    readFileSync(resolve(MIGRATIONS, 'seed/essensplanung/umrechnung_zuordnung.csv'), 'utf8')
  );
  for (const row of zuordnung) {
    const zutat = byName(row.zutat);
    assert.equal(zutat.grammProTl, row.gramm_pro_tl ? Number(row.gramm_pro_tl) : null, row.zutat);
    assert.equal(zutat.grammProEl, row.gramm_pro_el ? Number(row.gramm_pro_el) : null, row.zutat);
  }
});

dbTest('previews get an invented log once, before anyone changed something', async () => {
  await seedPreviewEssensplanung();
  await seedPreviewEssensplanung();
  const log = await getDb().selectFrom('essen.audit_log').select('actor').execute();
  assert.deepEqual(log.map((entry) => entry.actor).sort(), ['Theo Test', 'Vroni Vorschau']);
  await getDb().deleteFrom('essen.audit_log').execute();
});

dbTest('only the teams Admin and Vorstand reach the Steuerung', async (t) => {
  const url = 'intern/essensplanung/steuerung';
  assert.equal(
    (await EssensplanungSteuerung(request('GET', url, { roles: LEITUNG }), context(t))).status,
    403
  );
  const vorstand = [...LEITUNG, 'team_vorstand'];
  assert.equal(
    (await EssensplanungSteuerung(request('GET', url, { roles: vorstand }), context(t))).status,
    200
  );
  // Without the role of the Leitende, `requireStaff` already refuses
  const ohneLeitende = ['authenticated', 'team_admin'];
  assert.equal(
    (await EssensplanungSteuerung(request('GET', url, { roles: ohneLeitende }), context(t))).status,
    403
  );
});

dbTest('saving the settings checks the version and logs the changes', async (t) => {
  const before = view(
    await EssensplanungSteuerung(request('GET', 'intern/essensplanung/steuerung'), context(t))
  );
  const url = 'intern/pflege/essensplanung/einstellungen';
  const geaendert = { ...EINSTELLUNGEN, anlegenExtern: true, whitelist: ['dpsg-bezirk.de'] };

  const saved = await EssensplanungEinstellungen(
    request('PUT', url, { body: { etag: before.etag, einstellungen: geaendert } }),
    context(t)
  );
  assert.equal(saved.status, 200);
  assert.deepEqual(view(saved).einstellungen, geaendert);
  assert.equal(view(saved).updatedBy, 'admin@example.test');
  assert.deepEqual(view(saved).log[0].details, {
    changes: { anlegenExtern: { from: false, to: true }, whitelist: true },
  });

  const stale = await EssensplanungEinstellungen(
    request('PUT', url, { body: { etag: before.etag, einstellungen: EINSTELLUNGEN } }),
    context(t)
  );
  assert.equal(stale.status, 409);

  const invalid = await EssensplanungEinstellungen(
    request('PUT', url, {
      body: {
        etag: view(saved).etag,
        einstellungen: { ...EINSTELLUNGEN, aufbewahrungMonate: 500 },
      },
    }),
    context(t)
  );
  assert.equal(invalid.status, 400);
});

dbTest('ingredients are created, changed and deleted with their version', async (t) => {
  const start = view(
    await EssensplanungSteuerung(request('GET', 'intern/essensplanung/steuerung'), context(t))
  );
  const kategorie = start.kategorien.find((k) => k.name === 'Backware')!;
  const gluten = start.unvertraeglichkeiten.find((u) => u.schluessel === 'gluten')!;
  const params = { liste: 'zutaten' };

  const created = await EssensplanungListe(
    request('POST', 'intern/pflege/essensplanung/zutaten', {
      params,
      body: zutatInput({ kategorieId: kategorie.id, allergene: [gluten.id] }),
    }),
    context(t)
  );
  assert.equal(created.status, 201);
  const { id, view: afterCreate } = created.jsonBody as { id: number; view: EssenSteuerungView };
  const zutat = afterCreate.zutaten.find((z) => z.id === id)!;
  assert.deepEqual(zutat.allergene, [gluten.id]);
  assert.equal(zutat.grammProEl, 15);

  const duplicate = await EssensplanungListe(
    request('POST', 'intern/pflege/essensplanung/zutaten', {
      params,
      body: zutatInput({ name: 'testmehl', kategorieId: kategorie.id }),
    }),
    context(t)
  );
  assert.equal(duplicate.status, 400);
  assert.ok((duplicate.jsonBody as { fields: Record<string, string> }).fields.name);

  const itemParams = { liste: 'zutaten', id: String(id) };
  const changed = await EssensplanungListeEintrag(
    request('PATCH', `intern/pflege/essensplanung/zutaten/${id}`, {
      params: itemParams,
      body: {
        ...zutatInput({ name: 'Testmehl Type 405', kategorieId: kategorie.id }),
        etag: zutat.etag,
      },
    }),
    context(t)
  );
  assert.equal(changed.status, 200);
  const afterChange = view(changed).zutaten.find((z) => z.id === id)!;
  assert.equal(afterChange.name, 'Testmehl Type 405');
  assert.deepEqual(afterChange.allergene, []);
  assert.deepEqual(view(changed).log[0].details, {
    id,
    name: 'Testmehl Type 405',
    vorher: 'Testmehl',
    changes: ['name', 'allergene'],
  });

  const stale = await EssensplanungListeEintrag(
    request('DELETE', `intern/pflege/essensplanung/zutaten/${id}`, {
      params: itemParams,
      ifMatch: zutat.etag,
    }),
    context(t)
  );
  assert.equal(stale.status, 409);

  const deleted = await EssensplanungListeEintrag(
    request('DELETE', `intern/pflege/essensplanung/zutaten/${id}`, {
      params: itemParams,
      ifMatch: afterChange.etag,
    }),
    context(t)
  );
  assert.equal(deleted.status, 200);
  assert.equal(
    view(deleted).zutaten.some((z) => z.id === id),
    false
  );
  assert.equal(view(deleted).log[0].action, 'zutat-geloescht');
});

dbTest('used categories and the EU allergens cannot be deleted', async (t) => {
  const start = view(
    await EssensplanungSteuerung(request('GET', 'intern/essensplanung/steuerung'), context(t))
  );
  const backware = start.kategorien.find((k) => k.name === 'Backware')!;
  assert.ok(backware.zutaten > 0);
  const refused = await EssensplanungListeEintrag(
    request('DELETE', `intern/pflege/essensplanung/kategorien/${backware.id}`, {
      params: { liste: 'kategorien', id: String(backware.id) },
      ifMatch: backware.etag,
    }),
    context(t)
  );
  assert.equal(refused.status, 400);

  const created = await EssensplanungListe(
    request('POST', 'intern/pflege/essensplanung/kategorien', {
      params: { liste: 'kategorien' },
      body: { name: 'Grillgut' },
    }),
    context(t)
  );
  const neu = (created.jsonBody as { view: EssenSteuerungView }).view.kategorien.find(
    (k) => k.name === 'Grillgut'
  )!;
  const renamed = await EssensplanungListeEintrag(
    request('PATCH', `intern/pflege/essensplanung/kategorien/${neu.id}`, {
      params: { liste: 'kategorien', id: String(neu.id) },
      body: { name: 'Grill', etag: neu.etag },
    }),
    context(t)
  );
  const grill = view(renamed).kategorien.find((k) => k.id === neu.id)!;
  assert.equal(grill.name, 'Grill');
  const deleted = await EssensplanungListeEintrag(
    request('DELETE', `intern/pflege/essensplanung/kategorien/${neu.id}`, {
      params: { liste: 'kategorien', id: String(neu.id) },
      ifMatch: grill.etag,
    }),
    context(t)
  );
  assert.equal(deleted.status, 200);

  const gluten = start.unvertraeglichkeiten.find((u) => u.schluessel === 'gluten')!;
  const euRefused = await EssensplanungListeEintrag(
    request('DELETE', `intern/pflege/essensplanung/unvertraeglichkeiten/${gluten.id}`, {
      params: { liste: 'unvertraeglichkeiten', id: String(gluten.id) },
      ifMatch: gluten.etag,
    }),
    context(t)
  );
  assert.equal(euRefused.status, 400);

  const eigene = await EssensplanungListe(
    request('POST', 'intern/pflege/essensplanung/unvertraeglichkeiten', {
      params: { liste: 'unvertraeglichkeiten' },
      body: { name: 'Fructose' },
    }),
    context(t)
  );
  const fructose = (eigene.jsonBody as { view: EssenSteuerungView }).view.unvertraeglichkeiten.find(
    (u) => u.name === 'Fructose'
  )!;
  assert.equal(fructose.schluessel, null);
  const weg = await EssensplanungListeEintrag(
    request('DELETE', `intern/pflege/essensplanung/unvertraeglichkeiten/${fructose.id}`, {
      params: { liste: 'unvertraeglichkeiten', id: String(fructose.id) },
      ifMatch: fructose.etag,
    }),
    context(t)
  );
  assert.equal(weg.status, 200);
});
