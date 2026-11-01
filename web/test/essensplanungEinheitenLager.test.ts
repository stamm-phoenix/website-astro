import assert from 'node:assert/strict';
import test from 'node:test';
import { einkaufsliste, postenMenge } from '../src/lib/essensplanungEinkauf.ts';
import { vorschau, type VorschauZeile } from '../src/lib/essensplanungEinheiten.ts';
import type { PlanungZutat } from '../src/lib/types.ts';

/**
 * Bringing units into line converts what the stock is worked out from too (what was cooked,
 * bought and fixed), so the shopping list needs the same before and after.
 */

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
  zeilen: 2,
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

/** 100 g in stock, 60 g used by a cooked dish; still needed: 60 g and 1 Bund. */
function stand() {
  return {
    tage: [
      {
        mahlzeiten: [
          {
            id: 1,
            ohneGruppen: [],
            einplanungen: [
              {
                id: 11,
                etag: 'e11',
                gerichtId: 100,
                faktor: 1,
                status: 'gekocht' as const,
                verbrauch: [{ planungZutatId: 1, menge: 60, einheit: 'g' }],
              },
              { id: 12, etag: 'e12', gerichtId: 100, faktor: 1, status: 'offen' as const },
            ],
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
        zutaten: [zeile(1, 60, 'g'), zeile(2, 1, 'bund')],
      },
    ],
    zutaten: [petersilie],
    geschaefte: [],
    bestand: [{ id: 5, etag: 'b5', planungZutatId: 1, menge: 100, einheit: 'g', hinweis: '' }],
    zusatzbedarf: [],
    einkaeufe: [],
  };
}

/** Takes the preview over, as the server saves it. */
function uebernimm(s: ReturnType<typeof stand>, zeilen: VorschauZeile[]): void {
  for (const z of zeilen) {
    const neu = { menge: z.menge!, einheit: z.einheit };
    if (z.stelle === 'gericht')
      Object.assign(
        s.gerichte.flatMap((g) => g.zutaten).find((l) => l.id === z.id)!,
        neu
      );
    else if (z.stelle === 'bestand')
      Object.assign(
        s.bestand.find((b) => b.id === z.id)!,
        neu
      );
    else if (z.stelle === 'verbrauch') {
      const einplanung = s.tage[0].mahlzeiten[0].einplanungen.find((e) => e.id === z.id)!;
      Object.assign(
        einplanung.verbrauch!.find((v) => v.einheit === z.von)!,
        neu
      );
    } else throw new Error(`unexpected ${z.stelle}`);
  }
}

test('stock, what was used and what is needed convert together; 2 Bund are still missing', () => {
  const vorher = stand();
  assert.deepEqual(
    einkaufsliste(vorher, new Map([[1, 'Tiefkühl']]))[0].kategorien[0].posten.map(postenMenge),
    ['20 g', '1 Bund']
  );
  const nachher = stand();
  const zeilen = vorschau(
    nachher,
    1,
    'bund',
    new Map([
      ['g', 0.05],
      ['bund', 1],
    ])
  );
  // The amount used by the cooked dish is in the preview, too
  assert.deepEqual(
    zeilen.map((z) => [z.stelle, z.vorher, z.nachher]),
    [
      ['gericht', '60 g', '3 Bund'],
      ['gericht', '1 Bund', '1 Bund'],
      ['bestand', '100 g', '5 Bund'],
      ['verbrauch', '60 g', '3 Bund'],
    ]
  );
  uebernimm(nachher, zeilen);
  assert.deepEqual(
    einkaufsliste(nachher, new Map([[1, 'Tiefkühl']]))[0].kategorien[0].posten.map(postenMenge),
    ['2 Bund']
  );
});
