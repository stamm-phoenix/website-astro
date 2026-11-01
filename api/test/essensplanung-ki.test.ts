import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import * as azureOpenai from '../lib/azure-openai';
import { AzureOpenAiError, readRetryAfter } from '../lib/azure-openai';
import type {
  EssenKatalog,
  Gericht,
  KatalogZutat,
  PlanungZutat,
} from '../lib/essen-gerichte-model';
import { KiNichtVerfuegbar, liesRezept, pruefeGericht, schaetzeUmrechnung } from '../lib/essen-ki';
import { PlanungError } from '../lib/essen-planung';

/**
 * The AI of the Essensplanung against a mocked deployment: what is sent (schema, no personal
 * data) and how answers and errors (429, 503, timeout) come back. No real calls.
 */

function katalogZutat(id: number, name: string, extra: Partial<KatalogZutat> = {}): KatalogZutat {
  return {
    id,
    name,
    kategorieId: 1,
    einheitenart: 'masse',
    abtropfgewicht: false,
    lebensmittel: true,
    vegetarisch: true,
    vegan: true,
    allergene: [],
    grammProTl: null,
    grammProEl: null,
    grammProStueck: null,
    ...extra,
  };
}

const KATALOG: EssenKatalog = {
  kategorien: [{ id: 1, name: 'Trockenware' }],
  unvertraeglichkeiten: [{ id: 7, name: 'Gluten', schluessel: 'gluten' }],
  zutaten: [
    katalogZutat(1, 'Spaghetti', { allergene: [7] }),
    katalogZutat(2, 'Olivenöl', { einheitenart: 'volumen' }),
    katalogZutat(3, 'Zucker', { grammProTl: 4, grammProEl: 12 }),
    katalogZutat(4, 'Zwiebel', { grammProStueck: 80 }),
    katalogZutat(5, 'Hackfleisch (Rind)', { vegetarisch: false, vegan: false }),
    katalogZutat(6, 'Salz'),
    // As in the start data: chopped tomatoes and kidney beans count by drained weight
    katalogZutat(8, 'Tomaten (stückig)', { abtropfgewicht: true }),
    katalogZutat(11, 'Tomaten (passiert)'),
    katalogZutat(12, 'Kidneybohnen', { abtropfgewicht: true }),
    katalogZutat(13, 'Tomatenmark'),
    katalogZutat(10, 'Sahne', { einheitenart: 'volumen' }),
    katalogZutat(14, 'Brot (Laib)', { einheitenart: 'stueck', grammProStueck: 750 }),
    katalogZutat(9, 'Spülmittel', { lebensmittel: false, einheitenart: 'volumen' }),
  ],
};

const SPAGHETTI: PlanungZutat = {
  id: 11,
  etag: 'pz-11',
  zutatId: 1,
  name: 'Spaghetti',
  kategorieId: 1,
  einheitenart: 'masse',
  abtropfgewicht: false,
  lebensmittel: true,
  vegetarisch: true,
  vegan: true,
  allergene: [7],
  abweichend: { kategorie: false, einheitenart: false },
  zeilen: 1,
  geschaeftId: null,
};

const HACK: PlanungZutat = {
  ...SPAGHETTI,
  id: 12,
  zutatId: 5,
  name: 'Hackfleisch (Rind)',
  vegetarisch: false,
  vegan: false,
  allergene: [],
};

const GERICHT: Gericht = {
  id: 21,
  etag: 'g-21',
  name: 'Spagetti Bolognese',
  personen: 10,
  anleitung: 'Kochen mit Kim Küche, Telefon 0170 1234567',
  notiz: 'Zuständig: Kim Küche',
  links: [],
  werkzeuge: [],
  zutaten: [
    {
      id: 31,
      etag: 'z-31',
      position: 1,
      planungZutatId: 11,
      menge: 100,
      einheit: 'kg',
      fest: false,
      fuerAlles: true,
      fuerVegetarisch: true,
      fuerVegan: true,
      ohne: [],
      nur: [],
      hinweis: '',
    },
    {
      id: 32,
      etag: 'z-32',
      position: 2,
      planungZutatId: 12,
      menge: 1,
      einheit: 'kg',
      fest: false,
      fuerAlles: true,
      fuerVegetarisch: true,
      fuerVegan: false,
      ohne: [],
      nur: [],
      hinweis: '',
    },
  ],
};

function key(t: TestContext): void {
  const previous = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previous === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previous;
  });
}

interface Gesendet {
  body: Record<string, unknown>;
}

/** Answers every request with `answer` as the model's JSON; records what was sent. */
function modell(t: TestContext, answer: unknown): Gesendet[] {
  key(t);
  const gesendet: Gesendet[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    gesendet.push({ body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
  });
  return gesendet;
}

function hinweis(extra: Record<string, unknown>) {
  return {
    art: 'menge',
    zeile: null,
    text: 'Text',
    vorschlag: '',
    menge: null,
    einheit: null,
    fuerAlles: null,
    fuerVegetarisch: null,
    fuerVegan: null,
    ...extra,
  };
}

test('the check sends a strict schema and the dish without personal data', async (t) => {
  const gesendet = modell(t, { hinweise: [] });
  const pruefung = await pruefeGericht(GERICHT, [SPAGHETTI, HACK], KATALOG);
  assert.deepEqual(pruefung, { hinweise: [], personen: 10 });
  const body = gesendet[0].body;
  const format = body.response_format as { json_schema: { strict: boolean; name: string } };
  assert.equal(format.json_schema.strict, true);
  assert.equal(format.json_schema.name, 'essen_gericht_pruefen');
  const text = JSON.stringify(body.messages);
  assert.match(text, /Spaghetti/);
  assert.match(text, /Gluten/);
  // Instructions and notes may name people; they never reach the model
  assert.doesNotMatch(text, /Kim|0170/);
});

test('hints keep only fitting changes and name the checked version of the line', async (t) => {
  modell(t, {
    hinweise: [
      hinweis({ zeile: 1, text: '100 kg Spaghetti sind viel.', menge: 1, einheit: 'kg' }),
      // ml does not fit pasta: the hint stays, the change goes
      hinweis({ zeile: 1, text: 'Lieber in ml?', menge: 500, einheit: 'ml' }),
      hinweis({
        art: 'ernaehrung',
        zeile: 2,
        text: 'Hackfleisch ist nicht vegetarisch.',
        fuerVegetarisch: false,
      }),
      // A line for no diet at all is refused
      hinweis({ zeile: 2, text: 'Für niemanden?', fuerAlles: false, fuerVegetarisch: false }),
      hinweis({ art: 'unbekannt', zeile: 9, text: 'Es fehlt Salz.' }),
      hinweis({ text: '   ' }),
      'kein Hinweis',
    ],
  });
  const { hinweise } = await pruefeGericht(GERICHT, [SPAGHETTI, HACK], KATALOG);
  assert.deepEqual(hinweise, [
    {
      art: 'menge',
      zeile: { id: 31, etag: 'z-31' },
      text: '100 kg Spaghetti sind viel.',
      vorschlag: '',
      aenderung: { menge: 1, einheit: 'kg' },
    },
    { art: 'menge', zeile: { id: 31, etag: 'z-31' }, text: 'Lieber in ml?', vorschlag: '' },
    {
      art: 'ernaehrung',
      zeile: { id: 32, etag: 'z-32' },
      text: 'Hackfleisch ist nicht vegetarisch.',
      vorschlag: '',
      aenderung: { fuerVegetarisch: false },
    },
    { art: 'menge', zeile: { id: 32, etag: 'z-32' }, text: 'Für niemanden?', vorschlag: '' },
    { art: 'sonstiges', text: 'Es fehlt Salz.', vorschlag: '' },
  ]);
});

test('a recipe is mapped onto the lists, converted and scaled to the dish', async (t) => {
  const gesendet = modell(t, {
    rezeptPersonen: 4,
    zeilen: [
      {
        original: '400 g Spaghetti',
        name: 'Spaghetti',
        key: 'p11',
        menge: 400,
        einheit: 'g',
        hinweis: '',
      },
      {
        original: '2 EL Olivenöl',
        name: 'Olivenöl',
        key: 'z2',
        menge: 2,
        einheit: 'el',
        hinweis: '',
      },
      // The model chose nothing: the same name still maps
      { original: '1 TL zucker', name: 'zucker', key: null, menge: 1, einheit: 'tl', hinweis: '' },
      {
        original: '2 Zwiebeln',
        name: 'Zwiebeln',
        key: 'z4',
        menge: 2,
        einheit: 'stueck',
        hinweis: 'gehackt',
      },
      {
        original: '500 g Hack',
        name: 'Hackfleisch',
        key: 'z5',
        menge: 500,
        einheit: 'g',
        hinweis: '',
      },
      // An invented key and an unknown name: marked for the member; tomato paste has no grams
      {
        original: '1 Prise Muskat',
        name: 'Muskat',
        key: 'z999',
        menge: 1,
        einheit: 'prise',
        hinweis: '',
      },
      {
        original: '2 EL Tomatenmark',
        name: 'Tomatenmark',
        key: null,
        menge: 2,
        einheit: 'el',
        hinweis: '',
      },
      {
        original: 'Spülmittel',
        name: 'Spülmittel',
        key: 'z9',
        menge: null,
        einheit: null,
        hinweis: '',
      },
    ],
  });
  const rezept = await liesRezept('Spaghetti für 4 …', 10, [SPAGHETTI], KATALOG);
  const liste = JSON.stringify(gesendet[0].body.messages);
  // Things that are not food and central ingredients already in the Planung are not offered
  assert.doesNotMatch(liste, /Spülmittel|"z1"/);
  assert.equal(rezept.rezeptPersonen, 4);
  assert.equal(rezept.personen, 10);
  const kurz = rezept.zeilen.map(({ zutat, menge, einheit, hinweis, fuerVegetarisch }) => ({
    zutat,
    menge,
    einheit,
    hinweis,
    fuerVegetarisch,
  }));
  assert.deepEqual(kurz, [
    {
      zutat: { planungZutatId: 11 },
      menge: 1000,
      einheit: 'g',
      hinweis: '',
      fuerVegetarisch: true,
    },
    { zutat: { zutatId: 2 }, menge: 75, einheit: 'ml', hinweis: '', fuerVegetarisch: true },
    { zutat: { zutatId: 3 }, menge: 10, einheit: 'g', hinweis: '', fuerVegetarisch: true },
    { zutat: { zutatId: 4 }, menge: 400, einheit: 'g', hinweis: 'gehackt', fuerVegetarisch: true },
    { zutat: { zutatId: 5 }, menge: 1250, einheit: 'g', hinweis: '', fuerVegetarisch: false },
    { zutat: null, menge: null, einheit: null, hinweis: '1 Prise', fuerVegetarisch: true },
    // No grams per EL: the recipe's unit stays, scaled, never a note
    { zutat: { zutatId: 13 }, menge: 5, einheit: 'EL', hinweis: '', fuerVegetarisch: true },
    // Not offered, so not mapped either
    { zutat: null, menge: null, einheit: null, hinweis: '', fuerVegetarisch: true },
  ]);
  // A converted amount keeps the recipe's to take instead
  assert.deepEqual(
    rezept.zeilen.map((zeile) => zeile.rezeptMenge),
    [
      null,
      { menge: 5, einheit: 'EL' },
      { menge: 2.5, einheit: 'TL' },
      { menge: 5, einheit: 'stueck' },
      null,
      null,
      null,
      null,
    ]
  );
});

test('slices of an ingredient counted in pieces stay slices, never whole loaves', async (t) => {
  const zeile = (original: string, einheitRezept: string, extra: object = {}) => ({
    original,
    name: 'Brot',
    key: 'z14',
    menge: 2,
    einheit: 'stueck',
    einheitRezept,
    hinweis: '',
    inhaltMenge: null,
    inhaltEinheit: null,
    ...extra,
  });
  modell(t, {
    rezeptPersonen: 4,
    zeilen: [
      zeile('2 Scheiben Brot', 'Scheiben'),
      // A piece the recipe calls a piece is one of the list
      zeile('2 Brote', 'Stück'),
      // A content in g does not fit an ingredient counted in pieces: still slices
      zeile('2 Scheiben Brot (je 50 g)', 'Scheibe', { inhaltMenge: 50, inhaltEinheit: 'g' }),
    ],
  });
  const rezept = await liesRezept('…', 8, [], KATALOG);
  assert.deepEqual(
    rezept.zeilen.map(({ menge, einheit, rezeptMenge }) => ({ menge, einheit, rezeptMenge })),
    [
      { menge: 4, einheit: 'Scheibe', rezeptMenge: null },
      { menge: 4, einheit: 'stueck', rezeptMenge: null },
      { menge: 4, einheit: 'Scheibe', rezeptMenge: null },
    ]
  );
});

test("the recipe's word for a tin or a clove is kept where nothing converts it", async (t) => {
  modell(t, {
    rezeptPersonen: 4,
    zeilen: [
      {
        original: '3 Bund TK-Petersilie',
        name: 'Petersilie',
        key: 'z6',
        menge: 3,
        einheit: 'bund',
        einheitRezept: 'Bund',
        hinweis: '',
        inhaltMenge: null,
        inhaltEinheit: null,
      },
      {
        original: '2 Zehen Knoblauch',
        name: 'Knoblauch',
        key: 'z13',
        menge: 2,
        einheit: 'stueck',
        einheitRezept: 'Zehen',
        hinweis: 'gepresst',
        inhaltMenge: null,
        inhaltEinheit: null,
      },
    ],
  });
  const rezept = await liesRezept('…', 8, [], KATALOG);
  assert.deepEqual(
    rezept.zeilen.map(({ menge, einheit, hinweis, rezeptMenge }) => ({
      menge,
      einheit,
      hinweis,
      rezeptMenge,
    })),
    [
      // Salt is measured in g here, yet the bunches stay bunches
      { menge: 6, einheit: 'bund', hinweis: '', rezeptMenge: null },
      { menge: 4, einheit: 'Zehe', hinweis: 'gepresst', rezeptMenge: null },
    ]
  );
});

test('without people a recipe keeps its amounts and a check proposes none', async (t) => {
  modell(t, {
    rezeptPersonen: 4,
    zeilen: [
      {
        original: '400 g Spaghetti',
        name: 'Spaghetti',
        key: 'p11',
        menge: 400,
        einheit: 'g',
        hinweis: '',
      },
    ],
  });
  const rezept = await liesRezept('Spaghetti für 4 …', null, [SPAGHETTI], KATALOG);
  assert.equal(rezept.rezeptPersonen, 4);
  assert.equal(rezept.personen, null);
  assert.equal(rezept.zeilen[0].menge, 400);

  modell(t, {
    hinweise: [hinweis({ zeile: 1, text: '100 kg Spaghetti sind viel.', menge: 1, einheit: 'kg' })],
  });
  const pruefung = await pruefeGericht({ ...GERICHT, personen: null }, [SPAGHETTI, HACK], KATALOG);
  assert.equal(pruefung.personen, null);
  assert.equal(pruefung.hinweise[0].aenderung, undefined);
});

test('an implausible estimate of grams is no estimate', async (t) => {
  modell(t, { gramm: 400, begruendung: 'Ein Esslöffel Zucker.' });
  assert.deepEqual(await schaetzeUmrechnung('Zucker', 'el'), {
    mass: 'el',
    gramm: null,
    begruendung: 'Ein Esslöffel Zucker.',
  });
});

test('a plausible estimate of grams is rounded to a tenth', async (t) => {
  modell(t, { gramm: 12.34, begruendung: 'Kristallzucker, gestrichen.' });
  assert.equal((await schaetzeUmrechnung('Zucker', 'el')).gramm, 12.3);
});

test('429 and 503 of the deployment become „KI gerade nicht verfügbar“ with the wait', async (t) => {
  key(t);
  const antworten = [
    new Response('quota', { status: 429, headers: { 'Retry-After': '30' } }),
    new Response('busy', { status: 503 }),
    new Response('quota', { status: 429, headers: { 'retry-after-ms': '150000' } }),
  ];
  t.mock.method(globalThis, 'fetch', async () => antworten.shift()!);
  await assert.rejects(schaetzeUmrechnung('Zucker', 'el'), (error: unknown) => {
    assert.ok(error instanceof KiNichtVerfuegbar);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSeconds, 30);
    assert.match(error.message, /KI gerade nicht verfügbar, bitte in etwa 30 Sekunden/);
    return true;
  });
  await assert.rejects(schaetzeUmrechnung('Zucker', 'el'), (error: unknown) => {
    assert.ok(error instanceof KiNichtVerfuegbar);
    assert.equal(error.status, 503);
    assert.equal(error.retryAfterSeconds, undefined);
    assert.match(error.message, /bitte später noch einmal/);
    return true;
  });
  await assert.rejects(schaetzeUmrechnung('Zucker', 'el'), /in etwa 3 Minuten/);
});

test('a deployment that is too slow is unavailable, too', async (t) => {
  t.mock.method(azureOpenai, 'requestStructuredOutput', async () => {
    throw new AzureOpenAiError('Azure OpenAI request timed out', { timedOut: true });
  });
  await assert.rejects(
    pruefeGericht(GERICHT, [SPAGHETTI, HACK], KATALOG),
    (error: unknown) => error instanceof KiNichtVerfuegbar && error.status === 503
  );
});

test('other failures and unusable answers are an error of the AI, not unavailability', async (t) => {
  key(t);
  const antworten = [
    new Response('oops', { status: 500 }),
    Response.json({ choices: [{ message: { content: '{"zeilen": "keine Liste"}' } }] }),
  ];
  t.mock.method(globalThis, 'fetch', async () => antworten.shift()!);
  for (let i = 0; i < 2; i++) {
    await assert.rejects(
      liesRezept('Rezept', 4, [], KATALOG),
      (error: unknown) =>
        error instanceof PlanungError && error.status === 502 && error.code === 'KI_FEHLER'
    );
  }
});

test('Retry-After is read as seconds, milliseconds or a date, and capped', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const headers = (init: Record<string, string>) => new Headers(init);
  assert.equal(readRetryAfter(headers({ 'retry-after': '12' }), now), 12);
  assert.equal(readRetryAfter(headers({ 'retry-after-ms': '1500' }), now), 2);
  assert.equal(
    readRetryAfter(headers({ 'retry-after': 'Thu, 29 Oct 2026 12:01:00 GMT' }), now),
    60
  );
  assert.equal(readRetryAfter(headers({ 'retry-after': '999999' }), now), 3600);
  assert.equal(readRetryAfter(headers({ 'retry-after': 'bald' }), now), undefined);
  assert.equal(readRetryAfter(headers({}), now), undefined);
});

test('a tin with its weight in brackets counts by that weight, scaled', async (t) => {
  const zeile = (original: string, name: string, key: string, hinweis = '') => ({
    original,
    name,
    key,
    menge: 1,
    einheit: 'packung',
    hinweis,
    inhaltMenge: null,
    inhaltEinheit: null,
  });
  modell(t, {
    rezeptPersonen: 4,
    zeilen: [
      zeile('1 Packung passierte Tomaten (500 g)', 'passierte Tomaten', 'z11'),
      // As the prompt now asks for it
      {
        ...zeile('1 Packung passierte Tomaten', 'passierte Tomaten', 'z11'),
        inhaltMenge: 500,
        inhaltEinheit: 'g',
      },
      zeile('1 Becher (200 ml) Sahne', 'Sahne', 'z10'),
      // A weight does not fit an ingredient measured by volume
      zeile('1 Becher Sahne (200 g)', 'Sahne', 'z10'),
    ],
  });
  const rezept = await liesRezept('…', 8, [], KATALOG);
  assert.deepEqual(
    rezept.zeilen.map(({ zutat, menge, einheit }) => ({ zutat, menge, einheit })),
    [
      { zutat: { zutatId: 11 }, menge: 1000, einheit: 'g' },
      { zutat: { zutatId: 11 }, menge: 1000, einheit: 'g' },
      { zutat: { zutatId: 10 }, menge: 400, einheit: 'ml' },
      // Counted in cups, as the recipe says
      { zutat: { zutatId: 10 }, menge: 2, einheit: 'packung' },
    ]
  );
});

test('for ingredients by drained weight only an express drained weight counts', async (t) => {
  const zeile = (original: string, name: string, key: string, hinweis = '') => ({
    original,
    name,
    key,
    menge: 1,
    einheit: 'packung',
    hinweis,
    inhaltMenge: null,
    inhaltEinheit: null,
  });
  modell(t, {
    rezeptPersonen: 4,
    zeilen: [
      zeile('1 Dose Kidneybohnen (400 g)', 'Kidneybohnen', 'z12'),
      {
        ...zeile('1 Dose Kidneybohnen (400 g)', 'Kidneybohnen', 'z12'),
        inhaltMenge: 400,
        inhaltEinheit: 'g',
      },
      zeile('1 Dose Kidneybohnen (Abtropfgewicht 240 g)', 'Kidneybohnen', 'z12'),
      zeile('1 Dose Kidneybohnen', 'Kidneybohnen', 'z12', 'abgetropft 240 g'),
      // The line of the test with the model: chopped tomatoes count by drained weight, too
      zeile('1 Dose gehackte Tomaten (400 g)', 'gehackte Tomaten', 'z8', 'gehackt, 400 g'),
    ],
  });
  const rezept = await liesRezept('…', 8, [], KATALOG);
  assert.deepEqual(
    rezept.zeilen.map(({ zutat, menge, einheit, hinweis }) => ({
      zutat,
      menge,
      einheit,
      hinweis,
    })),
    [
      // The filled weight is no drained weight: the tins are counted, with what one holds
      { zutat: { zutatId: 12 }, menge: 2, einheit: 'packung', hinweis: 'à 400 g' },
      { zutat: { zutatId: 12 }, menge: 2, einheit: 'packung', hinweis: 'à 400 g' },
      { zutat: { zutatId: 12 }, menge: 480, einheit: 'g', hinweis: '' },
      { zutat: { zutatId: 12 }, menge: 480, einheit: 'g', hinweis: 'abgetropft 240 g' },
      { zutat: { zutatId: 8 }, menge: 2, einheit: 'packung', hinweis: 'gehackt, 400 g' },
    ]
  );
});

test('hints use the words of the page, never the field names of the data', async (t) => {
  modell(t, {
    hinweise: [
      hinweis({
        art: 'unvertraeglichkeit',
        zeile: 1,
        text: 'Spaghetti enthalten Gluten.',
        vorschlag: 'Setze bei „nichtFuer“ Gluten, und fuerVegan bleibt.',
      }),
      hinweis({ text: 'Zeile mit planungZutatId 11 prüfen.' }),
    ],
  });
  const { hinweise } = await pruefeGericht(GERICHT, [SPAGHETTI, HACK], KATALOG);
  assert.equal(hinweise.length, 1);
  assert.equal(hinweise[0].vorschlag, 'Setze bei „nicht bei“ Gluten, und vegan bleibt.');
});

test("an amount that cannot be converted keeps the recipe's unit, scaled", async (t) => {
  modell(t, {
    rezeptPersonen: 4,
    zeilen: [
      {
        original: '2 EL Tomatenmark',
        name: 'Tomatenmark',
        key: 'z13',
        menge: 2,
        einheit: 'el',
        hinweis: '',
        inhaltMenge: null,
        inhaltEinheit: null,
      },
      {
        original: '1 Prise Salz',
        name: 'Salz',
        key: 'z6',
        menge: 1,
        einheit: 'prise',
        hinweis: '',
        inhaltMenge: null,
        inhaltEinheit: null,
      },
    ],
  });
  const rezept = await liesRezept('…', 8, [], KATALOG);
  assert.deepEqual(
    rezept.zeilen.map(({ zutat, menge, einheit, hinweis }) => ({ zutat, menge, einheit, hinweis })),
    [
      // Never saved as „nach Gefühl“ nor as a note: 2 EL for 4 people are 4 EL for 8
      { zutat: { zutatId: 13 }, menge: 4, einheit: 'EL', hinweis: '' },
      // A pinch stays a pinch, by eye
      { zutat: { zutatId: 6 }, menge: null, einheit: null, hinweis: '1 Prise' },
    ]
  );
});
