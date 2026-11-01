import assert from 'node:assert/strict';
import test from 'node:test';
import {
  anleitungAbsaetze,
  esserKalender,
  kochplan,
  personenText,
  rezeptWarnungen,
  rezeptZeilen,
  teilnehmendeZeilen,
} from '../src/lib/essensplanungDruck.ts';
import type { Gericht, PlanungAnsicht, PlanungZutat } from '../src/lib/types.ts';

const zutat = (id: number, name: string, extra: Partial<PlanungZutat> = {}): PlanungZutat => ({
  id,
  etag: '',
  zutatId: null,
  name,
  kategorieId: 1,
  einheitenart: 'masse',
  abtropfgewicht: false,
  lebensmittel: true,
  vegetarisch: true,
  vegan: true,
  allergene: [],
  abweichend: { kategorie: false, einheitenart: false },
  zeilen: 1,
  geschaeftId: null,
  ...extra,
});

const zeile = (id: number, planungZutatId: number, menge: number | null, extra = {}) => ({
  id,
  etag: '',
  planungZutatId,
  menge,
  einheit: menge === null ? null : ('g' as const),
  fest: false,
  fuerAlles: true,
  fuerVegetarisch: true,
  fuerVegan: true,
  ohne: [] as number[],
  nur: [] as number[],
  hinweis: '',
  ...extra,
});

const mahlzeit = (id: number, kennung: string, name: string, einplanungen = [] as unknown[]) => ({
  id,
  etag: '',
  position: 1,
  kennung,
  name,
  einplanungen,
  ohneGruppen: [] as number[],
});

/** Two days: Chili for 4 people at 1_2, 10 Pfadis all the time and 2 vegan Rover on day 2. */
const ansicht = {
  name: 'Sommerlager',
  tage: [
    {
      id: 1,
      etag: '',
      datum: '2027-08-01',
      nummer: 1,
      mahlzeiten: [
        mahlzeit(11, '1_1', 'Frühstück'),
        {
          ...mahlzeit(12, '1_2', 'Mittagessen', [
            {
              id: 100,
              etag: '',
              gerichtId: 50,
              position: 1,
              faktor: 1,
              zustaendigId: null,
              zustaendig: 'Kim',
            },
          ]),
          // A time an older page saved is no longer shown
          uhrzeit: '12:30',
        },
      ],
    },
    {
      id: 2,
      etag: '',
      datum: '2027-08-02',
      nummer: 2,
      mahlzeiten: [{ ...mahlzeit(21, '2_1', 'Frühstück'), ohneGruppen: [1] }],
    },
  ],
  gruppen: [
    { id: 1, etag: '', position: 1, name: 'Pfadi', faktor: 1 },
    { id: 2, etag: '', position: 2, name: 'Rover', faktor: 1.5 },
  ],
  teilnehmende: [
    {
      id: 1,
      etag: '',
      gruppeId: 1,
      ernaehrung: 'alles',
      anzahl: 10,
      unvertraeglichkeiten: [],
      vonMahlzeitId: null,
      bisMahlzeitId: null,
      hinweis: '',
    },
    {
      id: 2,
      etag: '',
      gruppeId: 2,
      ernaehrung: 'vegan',
      anzahl: 2,
      unvertraeglichkeiten: [7],
      vonMahlzeitId: 21,
      bisMahlzeitId: null,
      hinweis: 'reisen mit dem Zug an',
    },
  ],
  gerichte: [
    {
      id: 50,
      etag: '',
      name: 'Chili',
      personen: 4,
      anleitung: '',
      notiz: '',
      links: [],
      werkzeuge: [],
      zutaten: [
        zeile(1, 1, 400, { fuerVegetarisch: false, fuerVegan: false }),
        zeile(2, 2, null, { hinweis: 'zum Schluss' }),
      ],
    },
  ],
  zutaten: [
    zutat(1, 'Hackfleisch', { vegetarisch: false, vegan: false }),
    zutat(2, 'Salz', { allergene: [7] }),
  ],
} as unknown as PlanungAnsicht;

const namen = new Map([[7, 'Gluten']]);

test('the plan lists each meal with its dishes, portions and amounts', () => {
  const tage = kochplan(ansicht, namen);
  assert.deepEqual(
    tage.map((tag) => tag.titel),
    ['Tag 1 · So., 1.8.2027', 'Tag 2 · Mo., 2.8.2027']
  );
  const mittag = tage[0].mahlzeiten[1];
  assert.equal(mittag.titel, '1_2 Mittagessen');
  assert.equal(mittag.gerichte[0].kennung, '1_2_1');
  assert.equal(mittag.gerichte[0].name, 'Chili');
  assert.equal(mittag.gerichte[0].portionen, 10);
  assert.equal(mittag.gerichte[0].zustaendig, 'Kim');
  assert.deepEqual(mittag.gerichte[0].zeilen, [
    { menge: '1 kg', name: 'Hackfleisch', fuer: 'nur mit allem', hinweis: '' },
    { menge: 'nach Gefühl', name: 'Salz', fuer: '', hinweis: 'zum Schluss' },
  ]);
  assert.equal(tage[1].mahlzeiten[0].ohne, 'ohne Pfadi');
  assert.equal(mittag.gerichte[0].personenFehlen, false);
});

test('a dish without people says so for the lines that scale; fixed amounts count', () => {
  const ohne = {
    ...ansicht,
    gerichte: [
      {
        ...ansicht.gerichte[0],
        personen: null,
        zutaten: [...ansicht.gerichte[0].zutaten, zeile(3, 2, 5, { fest: true })],
      },
    ],
  } as unknown as PlanungAnsicht;
  const gericht = kochplan(ohne, namen)[0].mahlzeiten[1].gerichte[0];
  assert.equal(gericht.personenFehlen, true);
  assert.deepEqual(
    gericht.zeilen.map((z) => z.menge),
    ['Personenzahl fehlt', 'nach Gefühl', '5 g']
  );
  assert.equal(personenText(ohne.gerichte[0]), 'Personenzahl fehlt');
  assert.equal(personenText(ansicht.gerichte[0]), 'Für 4 Personen');
});

test('a recipe card names what a line contains and for whom it is', () => {
  const zeilen = rezeptZeilen(ansicht.gerichte[0], ansicht.zutaten, namen);
  assert.deepEqual(zeilen, [
    {
      menge: '400 g',
      name: 'Hackfleisch',
      fuer: 'nur mit allem · nicht vegetarisch',
      hinweis: '',
    },
    { menge: 'nach Gefühl', name: 'Salz', fuer: 'enthält Gluten', hinweis: 'zum Schluss' },
  ]);
  // Without the names of the list an allergen never reads as none
  assert.equal(
    rezeptZeilen(ansicht.gerichte[0], ansicht.zutaten, new Map())[1].fuer,
    'enthält Allergene (Namen nicht geladen)'
  );
});

test('the eaters read as a calendar with the days across', () => {
  const kalender = esserKalender(ansicht);
  assert.deepEqual(kalender.tage, ['Tag 1 · So., 1.8.2027', 'Tag 2 · Mo., 2.8.2027']);
  assert.equal(kalender.zeilen.length, 2);
  assert.deepEqual(kalender.zeilen[0][1], {
    titel: '2_1 Frühstück',
    ohne: 'ohne Pfadi',
    personen: 2,
    vegetarisch: 0,
    vegan: 2,
  });
  // Day 2 has one meal only
  assert.equal(kalender.zeilen[1][1], null);
  assert.equal(kalender.zeilen[1][0]?.personen, 10);
});

test('participants name their group, diet, intolerances, when they are there and the note', () => {
  assert.deepEqual(teilnehmendeZeilen(ansicht, namen), [
    ['Pfadi', '10', 'mit allem', '', 'die ganze Zeit', ''],
    ['Rover', '2', 'vegan', 'Gluten', 'ab 2_1 Frühstück', 'reisen mit dem Zug an'],
  ]);
});

test('instructions in Markdown become headings, paragraphs and list items', () => {
  assert.deepEqual(
    anleitungAbsaetze(
      '## Vorbereiten\n\nZwiebeln **fein** hacken.\n\n1. Anbraten\n2. Würzen, siehe [Rezept](https://example.org)\n\n- [x] Topf'
    ),
    [
      { art: 'ueberschrift', text: 'Vorbereiten', ebene: 0 },
      { art: 'absatz', text: 'Zwiebeln fein hacken.', ebene: 0 },
      { art: 'punkt', text: '1. Anbraten', ebene: 0 },
      { art: 'punkt', text: '2. Würzen, siehe Rezept (https://example.org)', ebene: 0 },
      { art: 'punkt', text: '[x] Topf', ebene: 0 },
    ]
  );
  assert.deepEqual(anleitungAbsaetze('  '), []);
});

test('a recipe card keeps the warnings of the card', () => {
  const gericht = {
    ...ansicht.gerichte[0],
    zutaten: [zeile(9, 1, 400, { fuerVegetarisch: true, fuerVegan: false })],
  } as unknown as Gericht;
  const warnungen = rezeptWarnungen(gericht, ansicht.zutaten);
  assert.ok(
    warnungen.some((text) => text.includes('Hackfleisch')),
    warnungen.join(' | ')
  );
  assert.deepEqual(rezeptWarnungen(ansicht.gerichte[0], ansicht.zutaten), []);
});
