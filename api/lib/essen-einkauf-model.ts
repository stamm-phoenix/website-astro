import type { GerichtEinheit } from './essen-gerichte-model';

/**
 * Shops, stock and extra needs of a Planung, from which with the needs of the dishes the shopping
 * list comes (`docs/essensplanung.md`, Einkaufsliste). Without zod, so the page uses it too; the
 * checks of the forms are in `essen-einkauf-validation.ts`.
 */

export const MAX_GESCHAEFTE = 30;
/** Rows of stock and of extra needs, each. */
export const MAX_POSTEN = 500;
/** Up to this amount, rounded to three decimals as stored (`decimal(12, 3)`). */
export const MAX_MENGE = 1_000_000;

/** A shop of a Planung, e.g. „Metro“. */
export interface Geschaeft {
  id: number;
  etag: string;
  position: number;
  name: string;
}

/** An amount of an ingredient of the Planung: in the stock or needed without a dish. */
export interface EinkaufPosten {
  id: number;
  etag: string;
  planungZutatId: number;
  menge: number;
  einheit: GerichtEinheit;
  hinweis: string;
}

export interface GeschaeftInput {
  name: string;
}

export interface PostenInput {
  zutat: { zutatId: number } | { planungZutatId: number };
  menge: number;
  einheit: GerichtEinheit;
  hinweis: string;
}

export type PostenArt = 'bestand' | 'zusatzbedarf';

export const POSTEN_TEXT: Record<PostenArt, string> = {
  bestand: 'Bestand',
  zusatzbedarf: 'Zusatzbedarf',
};

export const MENGE_FEHLER = 'Bitte eine Menge größer 0 eintragen, z. B. 2,5.';
