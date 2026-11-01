import assert from 'node:assert/strict';
import test from 'node:test';
import { herkunft, herkunftTexte, type HerkunftStand } from '../src/lib/essensplanungHerkunft.ts';
import { ohneMenge, ohneMengeZeilen } from '../src/lib/essensplanungRechnung.ts';

const zeile = (
  id: number,
  planungZutatId: number,
  menge: number | null,
  einheit: 'g' | 'stueck' | 'bund' = 'g',
  fest = false
) => ({
  id,
  planungZutatId,
  menge,
  einheit: menge === null ? null : einheit,
  fest,
  fuerAlles: true,
  fuerVegetarisch: true,
  fuerVegan: true,
  ohne: [],
  nur: [],
});

/**
 * Two days: chili at 1_1 and 2_1, pasta also at 2_1 (cooked) and at 2_2; 8 people. Chili: 400 g
 * beans and 1 bunch of parsley for 4, pepper by eye. Pasta: 500 g pasta, 200 g beans, 2 pieces
 * of beans (a second line in another unit) fixed.
 */
function stand(): HerkunftStand {
  return {
    tage: [
      {
        mahlzeiten: [
          {
            id: 1,
            kennung: '1_1',
            ohneGruppen: [],
            einplanungen: [{ id: 11, gerichtId: 100, faktor: 1 }],
          },
        ],
      },
      {
        mahlzeiten: [
          {
            id: 2,
            kennung: '2_1',
            ohneGruppen: [],
            einplanungen: [
              { id: 21, gerichtId: 200, faktor: 1, status: 'gekocht' as const },
              { id: 22, gerichtId: 100, faktor: 0.5 },
            ],
          },
          {
            id: 3,
            kennung: '2_2',
            ohneGruppen: [],
            einplanungen: [{ id: 31, gerichtId: 200, faktor: 1 }],
          },
        ],
      },
    ],
    gruppen: [{ id: 1, faktor: 1 }],
    teilnehmende: [
      {
        gruppeId: 1,
        ernaehrung: 'alles' as const,
        anzahl: 8,
        unvertraeglichkeiten: [],
        vonMahlzeitId: null,
        bisMahlzeitId: null,
      },
    ],
    gerichte: [
      {
        id: 100,
        name: 'Chili',
        personen: 4,
        zutaten: [zeile(1, 1, 400), zeile(2, 3, null), zeile(3, 4, 1, 'bund')],
      },
      {
        id: 200,
        name: 'Nudeln',
        personen: 4,
        zutaten: [zeile(4, 2, 500), zeile(5, 1, 200), zeile(6, 1, 2, 'stueck', true)],
      },
    ],
    zutaten: [1, 2, 3, 4].map((id) => ({ id, abtropfgewicht: id === 1 })),
    zusatzbedarf: [
      { id: 7, planungZutatId: 1, menge: 1, einheit: 'kg', hinweis: 'Reserve' },
      { id: 8, planungZutatId: 5, menge: null, einheit: null, hinweis: '' },
    ],
  };
}

test('names the open dishes with their ID and amount, and the extra needs', () => {
  const h = herkunft(stand());
  // Beans: chili at 1_1 (800 g), chili at 2_1 half (400 g), pasta at 2_2 in two units; the
  // cooked pasta at 2_1 needs nothing more
  assert.deepEqual(herkunftTexte(h.get(1)), [
    'Chili (1_1_1) 800 g (ATG)',
    'Chili (2_1_2) 400 g (ATG)',
    'Nudeln (2_2_1) 400 g (ATG) + 2 Stück',
    'Zusatzbedarf 1 kg (ATG) (Reserve)',
  ]);
  assert.deepEqual(herkunftTexte(h.get(3)), [
    'Chili (1_1_1) nach Gefühl',
    'Chili (2_1_2) nach Gefühl',
  ]);
  // Measured in a unit of its own (a bunch), the line is named as it is
  assert.deepEqual(herkunftTexte(h.get(4)), ['Chili (1_1_1) 2 Bund', 'Chili (2_1_2) 1 Bund']);
  assert.deepEqual(herkunftTexte(h.get(5)), ['Zusatzbedarf']);
  assert.deepEqual(herkunftTexte(h.get(99)), []);
});

test('a trip up to a meal names only the dishes up to it, the extra needs always', () => {
  const h = herkunft(stand(), 2);
  assert.deepEqual(herkunftTexte(h.get(1)), [
    'Chili (1_1_1) 800 g (ATG)',
    'Chili (2_1_2) 400 g (ATG)',
    'Zusatzbedarf 1 kg (ATG) (Reserve)',
  ]);
  assert.equal(h.get(2), undefined);
  // A meal no longer there: all of them
  assert.equal(herkunft(stand(), 999).get(1)?.gerichte.length, 3);
});

test('the lines without an amount give the same ingredients as before', () => {
  const s = stand();
  assert.deepEqual(
    ohneMengeZeilen(s).map((z) => [z.einplanungId, z.planungZutatId]),
    [
      [11, 3],
      [22, 3],
    ]
  );
  assert.deepEqual([...ohneMenge(s)], [3]);
});
