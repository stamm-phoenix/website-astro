import type { GerichtEinheit } from './essen-gerichte-model';
import type { KiZutatWahl } from './essen-ki-model';
import type { EinplanungStatus } from './essen-kochen-model';
import type { PlanungGruppe, Teilnehmende } from './essen-teilnehmende-model';
import { esserJeMahlzeit } from './essen-teilnehmende-model';

/**
 * What „Gericht prüfen (KI)“ answers (`docs/essensplanung.md`, „KI“): an assessment of the whole
 * dish and hints, each of which may carry a change the page can take over with one click. Types
 * and the people a dish without its own number is checked for; without zod, so the page and the
 * mock API use it too. The answer of the model is read in `essen-ki-pruefen-antwort.ts`.
 */

export const KI_HINWEIS_ARTEN = [
  'menge',
  'zubereitung',
  'werkzeug',
  'fehlt',
  'ernaehrung',
  'unvertraeglichkeit',
  'tippfehler',
  'sonstiges',
] as const;
export type KiHinweisArt = (typeof KI_HINWEIS_ARTEN)[number];

/**
 * The ingredient a line becomes or a new line uses: one of the lists (`wahl`), or a name that is
 * in none (`wahl` null), which becomes an ingredient of the Planung's own with open details.
 */
export interface KiZutatAngabe {
  wahl: KiZutatWahl | null;
  name: string;
}

/** A change of a line the page can take over with one click. */
export interface KiAenderung {
  menge?: number;
  einheit?: GerichtEinheit;
  fuerAlles?: boolean;
  fuerVegetarisch?: boolean;
  fuerVegan?: boolean;
  hinweis?: string;
  /** Another ingredient for the line, e.g. „Vollkornnudeln“ instead of „Spaghetti“. */
  zutat?: KiZutatAngabe;
}

/** A line the AI proposes to add, with the amount for the people that were checked. */
export interface KiNeueZeile {
  zutat: KiZutatAngabe;
  /** null: without an amount, by eye. */
  menge: number | null;
  einheit: GerichtEinheit | null;
  fest: boolean;
  fuerAlles: boolean;
  fuerVegetarisch: boolean;
  fuerVegan: boolean;
  hinweis: string;
}

/**
 * A change of the tools: `alt` null adds `neu`, `neu` null removes `alt`, both rename `alt`.
 * `alt` is spelt as the dish has it.
 */
export interface KiWerkzeugAenderung {
  alt: string | null;
  neu: string | null;
}

export interface KiHinweis {
  art: KiHinweisArt;
  /** The line it is about, with the version that was checked; missing for the whole dish. */
  zeile?: { id: number; etag: string };
  text: string;
  vorschlag: string;
  /** Changes the line. */
  aenderung?: KiAenderung;
  /** Removes the line. */
  entfernen?: true;
  /** Adds a line to the dish. */
  neueZeile?: KiNeueZeile;
  /** Adds, renames or removes a tool. */
  werkzeug?: KiWerkzeugAenderung;
}

/** Where the number of people the check assumed comes from. */
export type KiPersonenQuelle = 'gericht' | 'anwesend';

export interface KiPruefung {
  /** In a few sentences, whether dish, amounts and preparation work for the people checked. */
  einschaetzung: string;
  hinweise: KiHinweis[];
  /**
   * The people of the dish that was checked (null: none yet); taking over an amount sends them
   * back.
   */
  personen: number | null;
  /**
   * The people the check assumed: the dish's own number, else the most people present at a meal
   * it is planned at (`personenQuelle` „anwesend“); null when it has neither.
   */
  geprueftFuer: number | null;
  personenQuelle: KiPersonenQuelle | null;
  /** Whether the dish had instructions to assess; without, only ingredients and tools count. */
  anleitungGeprueft: boolean;
}

/**
 * The most people present at a meal where the dish is planned and not left out (if it is left
 * out everywhere, all its meals count); null when it is planned nowhere or nobody is there. For a
 * dish without its own number, whose amounts are then totals for each meal.
 */
export function anwesendBeimGericht(
  planung: {
    tage: {
      datum: string;
      mahlzeiten: {
        id: number;
        position: number;
        ohneGruppen: number[];
        einplanungen: { gerichtId: number; status: EinplanungStatus }[];
      }[];
    }[];
    gruppen: Pick<PlanungGruppe, 'id' | 'faktor'>[];
    teilnehmende: Pick<
      Teilnehmende,
      'gruppeId' | 'ernaehrung' | 'anzahl' | 'vonMahlzeitId' | 'bisMahlzeitId'
    >[];
  },
  gerichtId: number
): number | null {
  const tage = planung.tage
    .toSorted((a, b) => a.datum.localeCompare(b.datum))
    .map((tag) => ({
      mahlzeiten: tag.mahlzeiten.toSorted((a, b) => a.position - b.position || a.id - b.id),
    }));
  const esser = esserJeMahlzeit({ ...planung, tage });
  const mahlzeiten = tage.flatMap((tag) => tag.mahlzeiten);
  const eingeplant = (mitAusgelassenen: boolean) =>
    mahlzeiten.filter((mahlzeit) =>
      mahlzeit.einplanungen.some(
        (einplanung) =>
          einplanung.gerichtId === gerichtId &&
          (mitAusgelassenen || einplanung.status !== 'ausgelassen')
      )
    );
  const orte = eingeplant(false).length ? eingeplant(false) : eingeplant(true);
  const meiste = Math.max(0, ...orte.map((mahlzeit) => esser.get(mahlzeit.id)?.personen ?? 0));
  return meiste > 0 ? meiste : null;
}
