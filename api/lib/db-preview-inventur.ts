import { getDb, inTransaction } from './db';
import type { InventarKategorie, InventarZustand } from './inventur-model';

const ACTOR = 'preview';

interface Beispiel {
  bezeichnung: string;
  kategorie: InventarKategorie;
  einheit: string;
  lagerort: string;
  zustand: InventarZustand;
  zubehoer?: string;
  fehlend?: string;
  notizen?: string;
  varianten: [string, number][];
}

const BEISPIELE: Beispiel[] = [
  {
    bezeichnung: 'Stammespulli (Test)',
    kategorie: 'kleidung',
    einheit: 'Stück',
    lagerort: 'Heimkeller, Regal 1',
    zustand: 'gut',
    varianten: [
      ['S', 4],
      ['M', 7],
      ['L', 3],
      ['XL', 0],
    ],
  },
  {
    bezeichnung: 'Aufnäher Stammeslogo (Test)',
    kategorie: 'aufnaeher',
    einheit: 'Stück',
    lagerort: 'Heimkeller, Schrank',
    zustand: 'gut',
    varianten: [
      ['Logo klein', 25],
      ['Logo groß', 12],
    ],
  },
  {
    bezeichnung: 'Kohte (Test)',
    kategorie: 'zelt',
    einheit: 'Stück',
    lagerort: 'Zeltlager-Container',
    zustand: 'reparatur',
    zubehoer: 'Zeltbahnen, Stangen, Heringe, Spannseile',
    fehlend: '3 Heringe fehlen, eine Bahn hat einen Riss am Rand.',
    varianten: [['', 2]],
  },
  {
    bezeichnung: 'Gaskocher (Test)',
    kategorie: 'lager',
    einheit: 'Stück',
    lagerort: 'Küchenkiste',
    zustand: 'gebrauchsspuren',
    notizen: 'Letzte Wartung vor dem Sommerlager.',
    varianten: [['', 3]],
  },
];

/** Invented articles of the Inventur (#107); skipped if the preview has some already. */
export async function seedPreviewInventur(): Promise<void> {
  const vorhanden = await getDb()
    .selectFrom('organisation.inventar_artikel')
    .select('id')
    .top(1)
    .executeTakeFirst();
  if (vorhanden) return;
  await inTransaction(async (trx) => {
    for (const beispiel of BEISPIELE) {
      const { varianten, ...artikel } = beispiel;
      const { id } = await trx
        .insertInto('organisation.inventar_artikel')
        .values({ ...artikel, updated_by: ACTOR })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('organisation.inventar_variante')
        .values(
          varianten.map(([bezeichnung, bestand], index) => ({
            artikel_id: id,
            bezeichnung,
            bestand,
            sortierung: index,
          }))
        )
        .execute();
    }
  });
}
