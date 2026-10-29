import assert from 'node:assert/strict';
import test from 'node:test';
import { einkaufsliste } from '../src/lib/essensplanungEinkauf.ts';
import type { PlanungZutat } from '../src/lib/types.ts';

const zutat = (
  id: number,
  name: string,
  kategorieId: number,
  geschaeftId: number | null
): PlanungZutat => ({
  id,
  etag: '',
  zutatId: null,
  name,
  kategorieId,
  einheitenart: 'masse',
  abtropfgewicht: false,
  lebensmittel: true,
  vegetarisch: true,
  vegan: true,
  allergene: [],
  abweichend: { kategorie: false, einheitenart: false },
  zeilen: 1,
  geschaeftId,
});

const zeile = (id: number, planungZutatId: number, menge: number, einheit: 'g' | 'stueck') => ({
  id,
  planungZutatId,
  menge,
  einheit,
  fest: false,
  fuerAlles: true,
  fuerVegetarisch: true,
  fuerVegan: true,
  ohne: [],
  nur: [],
});

test('the shopping list is need plus extra needs less stock, by shop and category', () => {
  const liste = einkaufsliste(
    {
      tage: [
        {
          mahlzeiten: [
            { id: 1, ohneGruppen: [], einplanungen: [{ id: 11, gerichtId: 100, faktor: 1 }] },
            { id: 2, ohneGruppen: [], einplanungen: [{ id: 12, gerichtId: 100, faktor: 1 }] },
          ],
        },
      ],
      gruppen: [{ id: 1, faktor: 1 }],
      teilnehmende: [
        {
          gruppeId: 1,
          ernaehrung: 'alles',
          anzahl: 10,
          unvertraeglichkeiten: [],
          vonMahlzeitId: null,
          bisMahlzeitId: null,
        },
      ],
      gerichte: [
        {
          id: 100,
          personen: 4,
          zutaten: [zeile(1, 1, 300, 'g'), zeile(2, 2, 1, 'stueck'), zeile(3, 3, 100, 'g')],
        },
      ],
      zutaten: [
        zutat(1, 'Nudeln', 7, 20),
        zutat(2, 'Zwiebel', 5, 20),
        zutat(3, 'Salz', 6, null),
        zutat(4, 'Spülmittel', 9, null),
      ],
      geschaefte: [
        { id: 10, etag: '', position: 1, name: 'Bäckerei' },
        { id: 20, etag: '', position: 2, name: 'Metro' },
      ],
      // The salt is all there; a little of the pasta too
      bestand: [
        { id: 1, etag: '', planungZutatId: 3, menge: 1, einheit: 'kg', hinweis: '' },
        { id: 2, etag: '', planungZutatId: 1, menge: 500, einheit: 'g', hinweis: '' },
      ],
      zusatzbedarf: [
        { id: 3, etag: '', planungZutatId: 4, menge: 2, einheit: 'stueck', hinweis: '' },
        { id: 4, etag: '', planungZutatId: 1, menge: 0.25, einheit: 'kg', hinweis: '' },
      ],
    },
    new Map([
      [5, 'Gemüse'],
      [7, 'Teigware'],
    ])
  );
  // Pasta: 2 × 750 g + 250 g − 500 g = 1,25 kg; onions 2 × 2,5 = 5 pieces; salt covered;
  // the bakery without anything is left out, things without a shop come last
  assert.deepEqual(liste, [
    {
      geschaeft: { id: 20, etag: '', position: 2, name: 'Metro' },
      kategorien: [
        {
          name: 'Gemüse',
          posten: [
            {
              planungZutatId: 2,
              name: 'Zwiebel',
              abtropfgewicht: false,
              menge: 5,
              einheit: 'stueck',
            },
          ],
        },
        {
          name: 'Teigware',
          posten: [
            {
              planungZutatId: 1,
              name: 'Nudeln',
              abtropfgewicht: false,
              menge: 1.25,
              einheit: 'kg',
            },
          ],
        },
      ],
    },
    {
      geschaeft: null,
      kategorien: [
        {
          name: 'Sonstiges',
          posten: [
            {
              planungZutatId: 4,
              name: 'Spülmittel',
              abtropfgewicht: false,
              menge: 2,
              einheit: 'stueck',
            },
          ],
        },
      ],
    },
  ]);
});

test('ingredients without an amount are bought „nach Gefühl“ unless listed or in stock', () => {
  const ohne = (id: number, planungZutatId: number) => ({
    ...zeile(id, planungZutatId, 0, 'g'),
    menge: null,
    einheit: null,
  });
  const liste = einkaufsliste(
    {
      tage: [
        {
          mahlzeiten: [
            { id: 1, ohneGruppen: [], einplanungen: [{ id: 11, gerichtId: 100, faktor: 1 }] },
          ],
        },
      ],
      gruppen: [{ id: 1, faktor: 1 }],
      teilnehmende: [
        {
          gruppeId: 1,
          ernaehrung: 'alles',
          anzahl: 4,
          unvertraeglichkeiten: [],
          vonMahlzeitId: null,
          bisMahlzeitId: null,
        },
      ],
      gerichte: [
        {
          id: 100,
          personen: 4,
          // Pepper only to taste; salt to taste but in stock; pasta also with an amount
          zutaten: [ohne(1, 1), ohne(2, 2), ohne(3, 3), zeile(4, 3, 400, 'g')],
        },
      ],
      zutaten: [
        zutat(1, 'Pfeffer', 6, null),
        zutat(2, 'Salz', 6, null),
        zutat(3, 'Nudeln', 6, null),
      ],
      geschaefte: [],
      bestand: [{ id: 1, etag: '', planungZutatId: 2, menge: 1, einheit: 'kg', hinweis: '' }],
      zusatzbedarf: [],
    },
    new Map([[6, 'Gewürz']])
  );
  assert.deepEqual(
    liste[0].kategorien[0].posten.map((p) => [p.name, p.menge, p.einheit]),
    [
      ['Nudeln', 400, 'g'],
      ['Pfeffer', null, null],
    ]
  );
});
