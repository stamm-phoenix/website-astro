import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { EssenKatalog, KatalogZutat, PlanungZutat } from '../lib/essen-gerichte-model';
import { readKopf } from '../lib/essen-gerichte-validation';
import { generiereGericht } from '../lib/essen-ki-generieren';
import { PlanungError } from '../lib/essen-zugang';
import { ValidationError } from '../lib/validation/errors';

/**
 * „Gericht generieren lassen (KI)“ against a mocked deployment: what is sent, how the written
 * dish is read, and the instructions and tools a batch of lines may set. No real calls.
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
  unvertraeglichkeiten: [],
  zutaten: [
    katalogZutat(1, 'Reis (Langkorn)'),
    katalogZutat(2, 'Olivenöl', { einheitenart: 'volumen' }),
    katalogZutat(3, 'Hackfleisch', { vegetarisch: false, vegan: false }),
    katalogZutat(4, 'Spülmittel', { lebensmittel: false, einheitenart: 'volumen' }),
  ],
};

const ZUTATEN: PlanungZutat[] = [];

function modell(t: TestContext, answer: unknown): Record<string, unknown>[] {
  const previous = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previous === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previous;
  });
  const gesendet: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    gesendet.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
  });
  return gesendet;
}

function zeile(extra: Record<string, unknown>) {
  return {
    original: '',
    name: '',
    key: null,
    menge: null,
    einheit: null,
    einheitRezept: '',
    hinweis: '',
    inhaltMenge: null,
    inhaltEinheit: null,
    ...extra,
  };
}

test('a dish is written from the description with a strict schema and only food to choose', async (t) => {
  const gesendet = modell(t, {
    rezeptPersonen: 20,
    zeilen: [
      zeile({ original: '2 kg Reis', name: 'Reis (Langkorn)', key: 'z1', menge: 2, einheit: 'kg' }),
      zeile({ original: '4 EL Olivenöl', name: 'Olivenöl', key: 'z2', menge: 4, einheit: 'el' }),
      zeile({
        original: '3 kg Hackfleisch',
        name: 'Hackfleisch',
        key: 'z3',
        menge: 3,
        einheit: 'kg',
      }),
      zeile({ original: 'Kreuzkümmel', name: 'Kreuzkümmel', hinweis: 'nach Geschmack' }),
    ],
    anleitung: '1. Reis kochen.\r\n2. Hack anbraten.\n',
    werkzeuge: ['Großer Topf', ' großer  topf ', 'Pfanne', 7, ''],
  });
  const gericht = await generiereGericht(
    'Chili mit Reis, eher mild',
    { name: 'Chili', personen: 20 },
    ZUTATEN,
    KATALOG
  );
  const body = gesendet[0];
  const format = body.response_format as { json_schema: { strict: boolean; name: string } };
  assert.equal(format.json_schema.strict, true);
  assert.equal(format.json_schema.name, 'essen_gericht_generieren');
  const nachricht = JSON.parse(
    (body.messages as { role: string; content: string }[])[1].content
  ) as { gericht: string; personen: number; beschreibung: string; liste: { key: string }[] };
  assert.equal(nachricht.gericht, 'Chili');
  assert.equal(nachricht.personen, 20);
  assert.equal(nachricht.beschreibung, 'Chili mit Reis, eher mild');
  // Non-food is no ingredient of a dish
  assert.deepEqual(
    nachricht.liste.map((eintrag) => eintrag.key),
    ['z1', 'z2', 'z3']
  );

  assert.equal(gericht.rezeptPersonen, 20);
  assert.equal(gericht.personen, 20);
  assert.deepEqual(
    gericht.zeilen.map((z) => [z.zutat, z.menge, z.einheit, z.fuerVegetarisch]),
    [
      [{ zutatId: 1 }, 2, 'kg', true],
      // TL and EL of an ingredient by volume become ml
      [{ zutatId: 2 }, 60, 'ml', true],
      [{ zutatId: 3 }, 3, 'kg', false],
      [null, null, null, true],
    ]
  );
  assert.equal(gericht.anleitung, '1. Reis kochen.\n2. Hack anbraten.');
  assert.deepEqual(gericht.werkzeuge, ['Großer Topf', 'Pfanne']);
});

test('a dish without people keeps the number the AI chose, to take over', async (t) => {
  modell(t, {
    rezeptPersonen: 10,
    zeilen: [
      zeile({ original: '1 kg Reis', name: 'Reis (Langkorn)', key: 'z1', menge: 1, einheit: 'kg' }),
    ],
    anleitung: '',
    werkzeuge: [],
  });
  const gericht = await generiereGericht(
    'Reis',
    { name: 'Reis', personen: null },
    ZUTATEN,
    KATALOG
  );
  assert.equal(gericht.rezeptPersonen, 10);
  assert.equal(gericht.personen, null);
  assert.equal(gericht.zeilen[0].menge, 1);
});

test('an answer without ingredients is an error of the AI', async (t) => {
  modell(t, { rezeptPersonen: 10, zeilen: [], anleitung: 'Kochen.', werkzeuge: [] });
  await assert.rejects(
    generiereGericht('Nichts', { name: 'Nichts', personen: 10 }, ZUTATEN, KATALOG),
    (error: unknown) => error instanceof PlanungError && error.code === 'KI_FEHLER'
  );
});

test('instructions and tools of a batch need the version they replace', () => {
  assert.equal(readKopf({}), undefined);
  assert.equal(readKopf({ kopf: null }), undefined);
  assert.deepEqual(readKopf({ kopf: { etag: 'v1', anleitung: 'Kochen.', werkzeuge: ['Topf'] } }), {
    etag: 'v1',
    anleitung: 'Kochen.',
    werkzeuge: ['Topf'],
  });
  assert.deepEqual(readKopf({ kopf: { etag: 'v1', werkzeuge: ['Topf', 'topf'] } }), {
    etag: 'v1',
    werkzeuge: ['Topf'],
  });
  const fehler = (body: Record<string, unknown>) => {
    try {
      readKopf(body);
    } catch (error: unknown) {
      assert.ok(error instanceof ValidationError);
      return Object.keys(error.fields);
    }
    assert.fail('expected a validation error');
  };
  assert.deepEqual(fehler({ kopf: { anleitung: 'Kochen.' } }), ['kopf']);
  assert.deepEqual(fehler({ kopf: { etag: 'v1' } }), ['kopf']);
  assert.deepEqual(fehler({ kopf: 'Kochen.' }), ['kopf']);
  assert.deepEqual(fehler({ kopf: { etag: 'v1', anleitung: 'x'.repeat(20_001) } }), [
    'kopf.anleitung',
  ]);
});
