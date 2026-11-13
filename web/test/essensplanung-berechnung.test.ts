import assert from 'node:assert/strict';
import test from 'node:test';
import { einplanungZeilen } from '../src/lib/essensplanungDruck.ts';
import { esserRechner } from '../src/lib/essensplanungRechnung.ts';
import type {
  Einplanung,
  PlanungAnsicht,
  PlanungMahlzeit,
} from '../../api/lib/essen-planung-model.ts';

// The numbers of the browser test `essensplanung-berechnung.spec.ts`: Chili for 4 people with
// mince only for those who eat meat and two lines of oil, planned for 10 Pfadis and 5 vegetarian
// Rover (factor 1.2) who cannot eat gluten.

const GLUTEN = 7;
const alle = { fuerAlles: true, fuerVegetarisch: true, fuerVegan: true };
const zeile = (
  id: number,
  planungZutatId: number,
  menge: number,
  einheit: 'g' | 'ml',
  extra = {}
) => ({
  id,
  etag: '',
  planungZutatId,
  menge,
  einheit,
  fest: false,
  ...alle,
  ohne: [] as number[],
  nur: [] as number[],
  hinweis: '',
  ...extra,
});

const ansicht = {
  gerichte: [
    {
      id: 1,
      name: 'Chili',
      personen: 4,
      zutaten: [
        zeile(1, 1, 400, 'g', { fuerVegetarisch: false, fuerVegan: false }),
        zeile(2, 2, 40, 'ml', { ohne: [GLUTEN] }),
        zeile(3, 2, 40, 'ml', { nur: [GLUTEN] }),
      ],
    },
  ],
  zutaten: [
    { id: 1, name: 'Hackfleisch', abtropfgewicht: false },
    { id: 2, name: 'Sonnenblumenöl', abtropfgewicht: false },
  ],
} as unknown as PlanungAnsicht;

const mahlzeit = (id: number, einplanungen: Einplanung[]): PlanungMahlzeit =>
  ({ id, kennung: `1_${id}`, ohneGruppen: [], einplanungen }) as unknown as PlanungMahlzeit;
const einplanung = (id: number, faktor: number): Einplanung =>
  ({ id, gerichtId: 1, faktor, zustaendig: null }) as unknown as Einplanung;

const mittag = mahlzeit(2, [einplanung(1, 1)]);
const abend = mahlzeit(4, [einplanung(2, 0.5)]);

const esser = esserRechner({
  tage: [{ mahlzeiten: [mittag, abend] }],
  gruppen: [
    { id: 1, faktor: 1 },
    { id: 2, faktor: 1.2 },
  ],
  teilnehmende: [
    {
      gruppeId: 1,
      ernaehrung: 'alles',
      anzahl: 10,
      unvertraeglichkeiten: [],
      vonMahlzeitId: null,
      bisMahlzeitId: null,
    },
    {
      gruppeId: 2,
      ernaehrung: 'vegetarisch',
      anzahl: 5,
      unvertraeglichkeiten: [GLUTEN],
      vonMahlzeitId: null,
      bisMahlzeitId: null,
    },
  ],
} as unknown as Parameters<typeof esserRechner>[0]);

const namen = new Map([[GLUTEN, 'Gluten']]);
const zeilen = (m: PlanungMahlzeit) =>
  einplanungZeilen(ansicht, m, m.einplanungen[0], esser, namen);

test('a planned dish counts the people who eat at the meal, weighted by their group', () => {
  assert.equal(zeilen(mittag).portionen, 16);
  // The factor of the planned dish halves the portions: 16 × 0.5
  assert.equal(zeilen(abend).portionen, 8);
});

test('mince only for those who eat meat, and two lines of oil that read apart', () => {
  const lunch = zeilen(mittag).zeilen.map(({ name, menge, fuer }) => [name, menge, fuer]);
  assert.deepEqual(lunch, [
    // 400 g ÷ 4 × 10 who eat meat
    ['Hackfleisch', '1 kg', 'nur mit allem · für 10 Portionen'],
    // 40 ml ÷ 4 × 10 in the pot, and 40 ml ÷ 4 × 6 Rover for the gluten-free one
    ['Sonnenblumenöl', '100 ml', 'nicht bei Gluten · für 10 Portionen'],
    ['Sonnenblumenöl', '60 ml', 'nur bei Gluten · für 6 Portionen'],
  ]);
});

test('half of the dish at dinner halves each line and the people it is counted for', () => {
  const dinner = zeilen(abend).zeilen.map(({ menge, fuer }) => [menge, fuer]);
  assert.deepEqual(dinner, [
    ['500 g', 'nur mit allem · für 5 Portionen'],
    ['50 ml', 'nicht bei Gluten · für 5 Portionen'],
    ['30 ml', 'nur bei Gluten · für 3 Portionen'],
  ]);
});
