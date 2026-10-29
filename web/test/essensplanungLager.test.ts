import assert from 'node:assert/strict';
import test from 'node:test';
import { einkaufsliste } from '../src/lib/essensplanungEinkauf.ts';
import { geplanterVerbrauch, lager, lagerZeilen } from '../src/lib/essensplanungLager.ts';
import type { PlanungZutat } from '../src/lib/types.ts';

const zutat = (id: number, name: string): PlanungZutat => ({
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
});

const zeile = (id: number, planungZutatId: number, menge: number | null) => ({
  id,
  planungZutatId,
  menge,
  einheit: menge === null ? null : ('g' as const),
  fest: false,
  fuerAlles: true,
  fuerVegetarisch: true,
  fuerVegan: true,
  ohne: [],
  nur: [],
});

/** Three meals of pasta for 4 (400 g each); the first cooked, the second left out. */
function stand() {
  return {
    tage: [
      {
        mahlzeiten: [1, 2, 3].map((id) => ({
          id,
          ohneGruppen: [],
          einplanungen: [
            {
              id: 10 + id,
              gerichtId: 100,
              faktor: 1,
              status:
                id === 1
                  ? ('gekocht' as const)
                  : id === 2
                    ? ('ausgelassen' as const)
                    : ('offen' as const),
              verbrauch:
                id === 1
                  ? [
                      { planungZutatId: 1, menge: 0.5, einheit: 'kg' as const },
                      { planungZutatId: 2, menge: 0, einheit: 'g' as const },
                    ]
                  : [],
            },
          ],
        })),
      },
    ],
    gruppen: [{ id: 1, faktor: 1 }],
    teilnehmende: [
      {
        gruppeId: 1,
        ernaehrung: 'alles' as const,
        anzahl: 4,
        unvertraeglichkeiten: [],
        vonMahlzeitId: null,
        bisMahlzeitId: null,
      },
    ],
    gerichte: [{ id: 100, personen: 4, zutaten: [zeile(1, 1, 400), zeile(2, 2, null)] }],
    zutaten: [zutat(1, 'Nudeln'), zutat(2, 'Pfeffer')],
    geschaefte: [],
    bestand: [
      { id: 1, etag: '', planungZutatId: 1, menge: 1, einheit: 'kg' as const, hinweis: '' },
    ],
    zusatzbedarf: [],
  };
}

test('the stock is what was there less what the cooked dishes used', () => {
  assert.deepEqual(lager(stand()), [
    { planungZutatId: 1, einheit: 'g', anfang: 1000, erhalten: 0, verbraucht: 500, jetzt: 500 },
    { planungZutatId: 2, einheit: 'g', anfang: 0, erhalten: 0, verbraucht: 0, jetzt: 0 },
  ]);
});

test('the shopping list counts only dishes still open, less what is in stock now', () => {
  // Only the third meal is open: 400 g, and 500 g are left, so no pasta to buy; pepper of the
  // open meal is bought „nach Gefühl“
  const liste = einkaufsliste(stand(), new Map([[1, 'Teigware']]));
  assert.deepEqual(
    liste.flatMap((g) => g.kategorien.flatMap((k) => k.posten.map((p) => [p.name, p.menge]))),
    [['Pfeffer', null]]
  );
  // When the first meal used it all, 400 g are missing
  const alles = stand();
  alles.tage[0].mahlzeiten[0].einplanungen[0].verbrauch[0].menge = 1;
  assert.deepEqual(
    einkaufsliste(alles, new Map([[1, 'Teigware']])).flatMap((g) =>
      g.kategorien.flatMap((k) => k.posten.map((p) => [p.name, p.menge, p.einheit]))
    ),
    [
      ['Nudeln', 400, 'g'],
      ['Pfeffer', null, null],
    ]
  );
});

test('the stock reads by name what was there, used and left', () => {
  assert.deepEqual(lagerZeilen(stand()), [
    {
      planungZutatId: 1,
      name: 'Nudeln',
      ersatz: '',
      anfang: '1 kg',
      erhalten: '0 g',
      verbraucht: '500 g',
      jetzt: '500 g',
      leer: false,
    },
  ]);
});

test('a dish cooked as planned uses the summed amounts of its lines', () => {
  const s = stand();
  const esser = () => 4;
  assert.deepEqual(geplanterVerbrauch(s.gerichte[0], { id: 3, ohneGruppen: [] }, 3, esser), [
    { planungZutatId: 1, menge: 1.2, einheit: 'kg' },
  ]);
});
