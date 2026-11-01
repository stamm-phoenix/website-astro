import assert from 'node:assert/strict';
import test from 'node:test';
import { einkaufsliste, postenMenge } from '../src/lib/essensplanungEinkauf.ts';
import { lager, vorraetig } from '../src/lib/essensplanungLager.ts';
import { einkaufsMenge, kochMenge, summiere } from '../src/lib/essensplanungRechnung.ts';
import { einheitenVorschlaege, vorschau } from '../src/lib/essensplanungEinheiten.ts';
import { uneinheitlicheZutaten } from '../../api/lib/essen-einheiten-model.ts';
import type { PlanungZutat } from '../src/lib/types.ts';

/** Units of one's own: summed per base unit, rounded up after summing, never converted. */

const petersilie: PlanungZutat = {
  id: 1,
  etag: '',
  zutatId: null,
  name: 'TK-Petersilie',
  kategorieId: 1,
  einheitenart: 'masse',
  abtropfgewicht: false,
  lebensmittel: true,
  vegetarisch: true,
  vegan: true,
  allergene: [],
  abweichend: { kategorie: false, einheitenart: false },
  zeilen: 3,
  geschaeftId: null,
};

const zeile = (id: number, menge: number, einheit: string) => ({
  id,
  etag: `z${id}`,
  position: id,
  planungZutatId: 1,
  menge,
  einheit,
  fest: false,
  fuerAlles: true,
  fuerVegetarisch: true,
  fuerVegan: true,
  ohne: [],
  nur: [],
  hinweis: '',
});

test("amounts are summed per base unit; a unit of one's own ignores upper and lower case", () => {
  const summen = summiere([
    { planungZutatId: 1, menge: 2, einheit: 'bund' },
    { planungZutatId: 1, menge: 150, einheit: 'g' },
    { planungZutatId: 1, menge: 0.05, einheit: 'kg' },
    { planungZutatId: 1, menge: 1.5, einheit: 'Dose' },
    { planungZutatId: 1, menge: 1, einheit: 'dose' },
  ]);
  assert.deepEqual(summen, [
    { planungZutatId: 1, einheit: 'bund', menge: 2 },
    { planungZutatId: 1, einheit: 'g', menge: 200 },
    { planungZutatId: 1, einheit: 'Dose', menge: 2.5 },
  ]);
  // Bought in whole tins, rounded only after summing
  assert.deepEqual(einkaufsMenge(2.5, 'Dose'), { menge: 3, einheit: 'Dose' });
  assert.equal(kochMenge(2.5, 'EL'), '2,5 EL');
});

const stand = {
  tage: [
    {
      mahlzeiten: [
        {
          id: 1,
          ohneGruppen: [],
          einplanungen: [{ id: 11, gerichtId: 100, faktor: 1, status: 'offen' as const }],
        },
      ],
    },
  ],
  gruppen: [{ id: 1, faktor: 1 }],
  teilnehmende: [
    {
      gruppeId: 1,
      ernaehrung: 'alles' as const,
      anzahl: 10,
      unvertraeglichkeiten: [],
      vonMahlzeitId: null,
      bisMahlzeitId: null,
    },
  ],
  gerichte: [
    {
      id: 100,
      name: 'Kräuterquark',
      personen: 10,
      zutaten: [zeile(1, 3, 'bund'), zeile(2, 2.5, 'EL')],
    },
  ],
  zutaten: [petersilie],
  geschaefte: [],
  bestand: [{ id: 5, etag: 'b5', planungZutatId: 1, menge: 1, einheit: 'el', hinweis: '' }],
  zusatzbedarf: [{ id: 4, etag: 'p4', planungZutatId: 1, menge: 200, einheit: 'g', hinweis: '' }],
};

test('the shopping list keeps each base unit a thing of its own, less stock in the same unit', () => {
  const liste = einkaufsliste(stand, new Map([[1, 'Tiefkühl']]));
  assert.deepEqual(
    liste[0].kategorien[0].posten.map((p) => postenMenge(p)),
    // 2.5 EL less 1 el in stock leaves 1.5, bought as 2
    ['3 Bund', '2 EL', '200 g']
  );
  assert.deepEqual([...vorraetig(stand)], [['1:el', 1]]);
  assert.equal(lager(stand)[0].einheit, 'el');
});

test('an ingredient in more than one base unit is offered to bring into line', () => {
  assert.deepEqual([...uneinheitlicheZutaten(stand)], [[1, ['bund', 'EL', 'g']]]);
  const zeilen = vorschau(
    stand,
    1,
    'g',
    new Map([
      ['bund', 20],
      ['el', 3],
      ['g', 1],
    ])
  );
  assert.deepEqual(
    zeilen.map((z) => [z.wo, z.vorher, z.nachher]),
    [
      ['Kräuterquark', '3 Bund', '60 g'],
      ['Kräuterquark', '2,5 EL', '7,5 g'],
      ['Zusatzbedarf', '200 g', '200 g'],
      ['Bestand', '1 el', '3 g'],
    ]
  );
  // Without a factor a line is not converted
  assert.equal(vorschau(stand, 1, 'g', new Map([['g', 1]]))[0].nachher, null);
});

test('the unit field suggests the units of the kind first, then all others', () => {
  const vorschlaege = einheitenVorschlaege('bund', ['Schale']);
  assert.deepEqual(vorschlaege.slice(0, 2), [
    { value: 'Bund', gruppe: 'Passend' },
    { value: 'g', gruppe: 'Weitere' },
  ]);
  assert.ok(vorschlaege.some((v) => v.value === 'EL'));
  assert.ok(vorschlaege.some((v) => v.value === 'Schale'));
});
