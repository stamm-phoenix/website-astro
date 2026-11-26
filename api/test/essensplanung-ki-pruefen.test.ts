import assert from 'node:assert/strict';
import test from 'node:test';
import type { Gericht } from '../lib/essen-gerichte-model';
import { anleitungFuerModell, pruefeGericht } from '../lib/essen-ki-pruefen';
import { anwesendBeimGericht } from '../lib/essen-ki-pruefen-model';
import { GERICHT, HACK, KATALOG, SPAGHETTI, modell } from './fixtures/essen-ki';

/**
 * „Gericht prüfen (KI)“ against a mocked deployment: what the model gets (tools, instructions,
 * people, never notes or contact data) and which of its proposals the page may take over.
 */

function hinweis(extra: Record<string, unknown>) {
  return {
    art: 'menge',
    aktion: null,
    zeile: null,
    text: 'Text',
    vorschlag: '',
    menge: null,
    einheit: null,
    fuerAlles: null,
    fuerVegetarisch: null,
    fuerVegan: null,
    fest: null,
    hinweisNeu: null,
    zutatKey: null,
    zutatName: null,
    werkzeug: null,
    werkzeugNeu: null,
    ...extra,
  };
}

const MIT_ANLEITUNG: Gericht = {
  ...GERICHT,
  anleitung: '1. Nudeln kochen.\n2. Fragen an kim@example.org oder 0170 1234567.',
  notiz: 'Zuständig: Kim Küche',
  werkzeuge: ['Topf 10 l', 'Sieb'],
};

/** The data the model got with the last request. */
function daten(gesendet: { body: Record<string, unknown> }[]): Record<string, unknown> {
  const messages = gesendet.at(-1)!.body.messages as { content: string }[];
  return JSON.parse(messages[1].content) as Record<string, unknown>;
}

test('the check sends tools and instructions, never notes or contact data', async (t) => {
  const gesendet = modell(t, {
    einschaetzung: 'Passt im Großen und Ganzen.\r\n\r\n\r\nDer Topf ist zu klein.',
    hinweise: [],
  });
  const pruefung = await pruefeGericht(MIT_ANLEITUNG, [SPAGHETTI, HACK], KATALOG);
  assert.deepEqual(pruefung, {
    einschaetzung: 'Passt im Großen und Ganzen.\n\nDer Topf ist zu klein.',
    hinweise: [],
    personen: 10,
    geprueftFuer: 10,
    personenQuelle: 'gericht',
    anleitungGeprueft: true,
    etag: 'g-21',
  });
  const format = gesendet[0].body.response_format as {
    json_schema: { strict: boolean; name: string };
  };
  assert.equal(format.json_schema.strict, true);
  assert.equal(format.json_schema.name, 'essen_gericht_pruefen');
  const gericht = daten(gesendet);
  assert.equal(gericht.personen, 10);
  assert.equal(gericht.personenQuelle, 'gericht');
  assert.deepEqual(gericht.werkzeuge, ['Topf 10 l', 'Sieb']);
  assert.equal(gericht.anleitung, '1. Nudeln kochen.\n2. Fragen an [E-Mail] oder [Telefon].');
  // The ingredients the model may pick for new lines, by key
  assert.ok((gericht.liste as { key: string }[]).some((eintrag) => eintrag.key === 'z6'));
  const text = JSON.stringify(gesendet[0].body.messages);
  assert.match(text, /Gluten/);
  assert.doesNotMatch(text, /Kim|0170|example\.org/);
});

test('without instructions there is nothing to assess about the preparation', async (t) => {
  const gesendet = modell(t, { einschaetzung: 'Passt.', hinweise: [] });
  const pruefung = await pruefeGericht({ ...GERICHT, anleitung: '  ' }, [SPAGHETTI], KATALOG);
  assert.equal(daten(gesendet).anleitung, null);
  assert.equal(pruefung.anleitungGeprueft, false);
});

test('a dish without people is checked for those present, its amounts as totals', async (t) => {
  const gesendet = modell(t, {
    einschaetzung: 'Für 40 Personen zu wenig.',
    hinweise: [hinweis({ zeile: 1, text: 'Zu wenig.', menge: 4, einheit: 'kg' })],
  });
  const ohne = { ...GERICHT, personen: null };
  const pruefung = await pruefeGericht(ohne, [SPAGHETTI, HACK], KATALOG, 40);
  assert.equal(pruefung.personen, null);
  assert.equal(pruefung.geprueftFuer, 40);
  assert.equal(pruefung.personenQuelle, 'anwesend');
  // Fixed totals like a line marked „feste Menge“: a new amount can be proposed
  assert.deepEqual(pruefung.hinweise[0].aenderung, { menge: 4, einheit: 'kg' });
  const gericht = daten(gesendet);
  assert.equal(gericht.personen, 40);
  assert.equal(gericht.personenQuelle, 'anwesend');
  assert.equal((gericht.zeilen as { fest: boolean }[])[0].fest, true);

  // Planned nowhere: no number at all
  modell(t, { einschaetzung: '', hinweise: [] });
  const nirgends = await pruefeGericht(ohne, [SPAGHETTI, HACK], KATALOG, null);
  assert.equal(nirgends.geprueftFuer, null);
  assert.equal(nirgends.personenQuelle, null);
});

test('changes of a line keep only what fits', async (t) => {
  modell(t, {
    einschaetzung: '',
    hinweise: [
      hinweis({ zeile: 1, text: '100 kg Spaghetti sind viel.', menge: 1, einheit: 'kg' }),
      // ml does not fit pasta: the hint stays, the change goes
      hinweis({ zeile: 1, text: 'Lieber in ml?', menge: 500, einheit: 'ml' }),
      hinweis({
        art: 'ernaehrung',
        aktion: 'zeile_aendern',
        zeile: 2,
        text: 'Hackfleisch ist nicht vegetarisch.',
        fuerVegetarisch: false,
      }),
      // A line for no diet at all is refused
      hinweis({ zeile: 2, text: 'Für niemanden?', fuerAlles: false, fuerVegetarisch: false }),
      hinweis({ art: 'unbekannt', zeile: 9, text: 'Es fehlt Salz.' }),
      hinweis({ text: '   ' }),
      'kein Hinweis',
      // Another note, and another ingredient from the list
      hinweis({
        aktion: 'zeile_aendern',
        zeile: 1,
        text: 'Lieber Zucker?',
        zutatKey: 'z3',
        hinweisNeu: 'al dente',
      }),
      // The same ingredient is no swap; pieces do not fit an ingredient in g
      hinweis({ aktion: 'zeile_aendern', zeile: 1, text: 'Gleich.', zutatKey: 'p11' }),
      hinweis({
        aktion: 'zeile_aendern',
        zeile: 1,
        text: 'Brot statt Nudeln?',
        zutatKey: 'z14',
      }),
      // A name in no list becomes an ingredient of the Planung's own
      hinweis({ aktion: 'zeile_aendern', zeile: 2, text: 'Tofu?', zutatName: 'Räuchertofu' }),
      hinweis({ aktion: 'zeile_entfernen', zeile: 2, text: 'Doppelt.' }),
      // Removing needs a line
      hinweis({ aktion: 'zeile_entfernen', text: 'Weg damit.' }),
    ],
  });
  const { hinweise } = await pruefeGericht(GERICHT, [SPAGHETTI, HACK], KATALOG);
  const zeile31 = { id: 31, etag: 'z-31' };
  const zeile32 = { id: 32, etag: 'z-32' };
  assert.deepEqual(hinweise, [
    {
      art: 'menge',
      zeile: zeile31,
      text: '100 kg Spaghetti sind viel.',
      vorschlag: '',
      aenderung: { menge: 1, einheit: 'kg' },
    },
    { art: 'menge', zeile: zeile31, text: 'Lieber in ml?', vorschlag: '' },
    {
      art: 'ernaehrung',
      zeile: zeile32,
      text: 'Hackfleisch ist nicht vegetarisch.',
      vorschlag: '',
      aenderung: { fuerVegetarisch: false },
    },
    { art: 'menge', zeile: zeile32, text: 'Für niemanden?', vorschlag: '' },
    { art: 'sonstiges', text: 'Es fehlt Salz.', vorschlag: '' },
    {
      art: 'menge',
      zeile: zeile31,
      text: 'Lieber Zucker?',
      vorschlag: '',
      aenderung: { hinweis: 'al dente', zutat: { wahl: { zutatId: 3 }, name: 'Zucker' } },
    },
    { art: 'menge', zeile: zeile31, text: 'Gleich.', vorschlag: '' },
    { art: 'menge', zeile: zeile31, text: 'Brot statt Nudeln?', vorschlag: '' },
    {
      art: 'menge',
      zeile: zeile32,
      text: 'Tofu?',
      vorschlag: '',
      aenderung: { zutat: { wahl: null, name: 'Räuchertofu' } },
    },
    { art: 'menge', zeile: zeile32, text: 'Doppelt.', vorschlag: '', entfernen: true },
    { art: 'menge', text: 'Weg damit.', vorschlag: '' },
  ]);
});

test('a missing ingredient becomes a line to add, never meat for vegetarians', async (t) => {
  modell(t, {
    einschaetzung: '',
    hinweise: [
      hinweis({
        art: 'fehlt',
        aktion: 'zutat_hinzufuegen',
        text: 'Salz fehlt.',
        zutatKey: 'z6',
        menge: 50,
        einheit: 'g',
        fest: true,
      }),
      // An invented key: the same name counts
      hinweis({
        art: 'fehlt',
        aktion: 'zutat_hinzufuegen',
        text: 'Hack fehlt.',
        zutatKey: 'x1',
        zutatName: 'hackfleisch (rind)',
      }),
      hinweis({
        art: 'fehlt',
        aktion: 'zutat_hinzufuegen',
        text: 'Basilikum fehlt.',
        zutatName: 'Basilikum',
        hinweisNeu: 'frisch',
      }),
      // ml do not fit salt in g; without ingredient there is nothing to add
      hinweis({
        aktion: 'zutat_hinzufuegen',
        text: 'Salz in ml.',
        zutatKey: 'z6',
        menge: 5,
        einheit: 'ml',
      }),
      hinweis({ aktion: 'zutat_hinzufuegen', text: 'Irgendwas fehlt.' }),
    ],
  });
  const { hinweise } = await pruefeGericht(GERICHT, [SPAGHETTI, HACK], KATALOG);
  const fuerAlle = { fuerAlles: true, fuerVegetarisch: true, fuerVegan: true };
  assert.deepEqual(
    hinweise.map((eintrag) => eintrag.neueZeile),
    [
      {
        zutat: { wahl: { zutatId: 6 }, name: 'Salz' },
        menge: 50,
        einheit: 'g',
        fest: true,
        ...fuerAlle,
        hinweis: '',
      },
      {
        zutat: { wahl: { planungZutatId: 12 }, name: 'Hackfleisch (Rind)' },
        menge: null,
        einheit: null,
        fest: false,
        fuerAlles: true,
        fuerVegetarisch: false,
        fuerVegan: false,
        hinweis: '',
      },
      {
        zutat: { wahl: null, name: 'Basilikum' },
        menge: null,
        einheit: null,
        fest: false,
        ...fuerAlle,
        hinweis: 'frisch',
      },
      undefined,
      undefined,
    ]
  );
});

test('tools are added, renamed or removed only where that fits the dish', async (t) => {
  modell(t, {
    einschaetzung: '',
    hinweise: [
      hinweis({
        art: 'werkzeug',
        aktion: 'werkzeug_hinzufuegen',
        text: 'Ein Kochlöffel fehlt.',
        werkzeugNeu: 'Kochlöffel',
      }),
      // Already there, in other case
      hinweis({ aktion: 'werkzeug_hinzufuegen', text: 'Sieb fehlt.', werkzeugNeu: 'sieb' }),
      hinweis({
        aktion: 'werkzeug_aendern',
        text: 'Der Topf ist zu klein.',
        werkzeug: 'topf 10 L',
        werkzeugNeu: 'Topf 30 l',
      }),
      // Renaming into another tool of the dish would make a double
      hinweis({
        aktion: 'werkzeug_aendern',
        text: 'Doppelt.',
        werkzeug: 'Sieb',
        werkzeugNeu: 'Topf 10 l',
      }),
      hinweis({ aktion: 'werkzeug_entfernen', text: 'Kein Sieb nötig.', werkzeug: 'Sieb' }),
      // A tool the dish does not have
      hinweis({ aktion: 'werkzeug_entfernen', text: 'Kein Wok nötig.', werkzeug: 'Wok' }),
    ],
  });
  const { hinweise } = await pruefeGericht(MIT_ANLEITUNG, [SPAGHETTI, HACK], KATALOG);
  assert.deepEqual(
    hinweise.map((eintrag) => eintrag.werkzeug),
    [
      { alt: null, neu: 'Kochlöffel' },
      undefined,
      { alt: 'Topf 10 l', neu: 'Topf 30 l' },
      undefined,
      { alt: 'Sieb', neu: null },
      undefined,
    ]
  );
});

test('hints use the words of the page, never the field names of the data', async (t) => {
  modell(t, {
    einschaetzung: 'Bei fuerVegan fehlt etwas.',
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
  const pruefung = await pruefeGericht(GERICHT, [SPAGHETTI, HACK], KATALOG);
  assert.equal(pruefung.einschaetzung, 'Bei vegan fehlt etwas.');
  assert.equal(pruefung.hinweise.length, 1);
  assert.equal(pruefung.hinweise[0].vorschlag, 'Setze bei „nicht bei“ Gluten, und vegan bleibt.');
});

test('contact data is taken out of the instructions', () => {
  assert.equal(
    anleitungFuerModell('Bei Fragen: +49 170 1234567, 0170/1234567 oder kim@example.org.'),
    'Bei Fragen: [Telefon], [Telefon] oder [E-Mail]'
  );
  // Amounts and times stay
  assert.equal(
    anleitungFuerModell('500 g Nudeln 10 Minuten kochen.'),
    '500 g Nudeln 10 Minuten kochen.'
  );
  assert.equal(anleitungFuerModell('  \n '), null);
});

test('those present are counted at the meals the dish is planned at', () => {
  const mahlzeit = (id: number, position: number, gerichtId: number | null, extra = {}) => ({
    id,
    position,
    ohneGruppen: [] as number[],
    einplanungen: gerichtId === null ? [] : [{ gerichtId, status: 'offen' as const }],
    ...extra,
  });
  const planung = {
    // Days out of order: counted by date
    tage: [
      { datum: '2026-07-02', mahlzeiten: [mahlzeit(3, 1, 21), mahlzeit(4, 2, null)] },
      {
        datum: '2026-07-01',
        mahlzeiten: [
          mahlzeit(1, 1, 21, { ohneGruppen: [2] }),
          mahlzeit(2, 2, 21, {
            einplanungen: [{ gerichtId: 21, status: 'ausgelassen' as const }],
          }),
        ],
      },
    ],
    gruppen: [
      { id: 1, faktor: 1 },
      { id: 2, faktor: 0.5 },
    ],
    teilnehmende: [
      {
        gruppeId: 1,
        ernaehrung: 'alles' as const,
        anzahl: 20,
        vonMahlzeitId: null,
        bisMahlzeitId: null,
      },
      // Leave after the first meal of day 1: never at meal 3
      {
        gruppeId: 2,
        ernaehrung: 'vegan' as const,
        anzahl: 15,
        vonMahlzeitId: null,
        bisMahlzeitId: 2,
      },
    ],
  };
  // Meal 1 without group 2 (20), meal 2 left out (35 would count), meal 3 after they left (20)
  assert.equal(anwesendBeimGericht(planung, 21), 20);
  // Left out everywhere: those meals count after all
  const ausgelassen = structuredClone(planung);
  ausgelassen.tage[0].mahlzeiten[0].einplanungen = [];
  ausgelassen.tage[1].mahlzeiten[0].einplanungen = [];
  assert.equal(anwesendBeimGericht(ausgelassen, 21), 35);
  assert.equal(anwesendBeimGericht(planung, 99), null);
});
