import type { EssenEinheitenart } from './essen-schema';

/**
 * „Zutaten prüfen (KI)“ (`docs/essensplanung.md`, „KI“): the AI checks the values of ingredients
 * of a Planung or of the central list and proposes changes, which the user takes over one by one
 * or all at once. Types and texts without zod, so the browser imports them.
 */

/** At most this many ingredients per question; the page asks in portions. */
export const MAX_KI_ZUTATEN = 25;

/** The values of an ingredient the AI checks and may change. */
export interface KiZutatWerte {
  name: string;
  kategorieId: number;
  einheitenart: EssenEinheitenart;
  lebensmittel: boolean;
  vegetarisch: boolean | null;
  vegan: boolean | null;
  allergene: number[];
  /** Only for central ingredients in g/kg; ingredients of a Planung have none. */
  grammProTl: number | null;
  grammProEl: number | null;
  grammProStueck: number | null;
}

export type KiZutatFeld =
  | 'name'
  | 'kategorie'
  | 'einheitenart'
  | 'lebensmittel'
  | 'ernaehrung'
  | 'allergene'
  | 'grammProTl'
  | 'grammProEl'
  | 'grammProStueck';

/** One proposed change, as the page shows it: „Kategorie: Sonstiges → Gewürze“. */
export interface KiZutatAenderung {
  feld: KiZutatFeld;
  label: string;
  alt: string;
  neu: string;
}

/**
 * `vorschlag`: the AI proposes changes; `passt`: nothing to change; `unklar`: the AI could not
 * tell what the name means (e.g. too colloquial), so it proposes nothing; `ohne_antwort`: the
 * answer left it out. None of them is dropped, so every ingredient asked about is shown.
 */
export type KiZutatStatus = 'vorschlag' | 'passt' | 'unklar' | 'ohne_antwort';

export interface KiZutatErgebnis {
  /** The ingredient of the Planung, or the central one. */
  id: number;
  /** Its version when it was checked; taking over a proposal conflicts with a later change. */
  etag: string;
  name: string;
  status: KiZutatStatus;
  /** Why it proposes the changes, or why the name is unclear. */
  text: string;
  aenderungen: KiZutatAenderung[];
  /** All values after the proposal; null unless `vorschlag`. */
  vorschlag: KiZutatWerte | null;
}

export interface KiZutatPruefung {
  ergebnisse: KiZutatErgebnis[];
}

export const KI_ZUTAT_STATUS_TEXT: Record<KiZutatStatus, string> = {
  vorschlag: 'Änderung vorgeschlagen',
  passt: 'Passt',
  unklar: 'Nicht verstanden',
  ohne_antwort: 'Keine Antwort',
};

/** The ids of `ids` in portions the API takes in one question. */
export function kiPortionen(ids: readonly number[], groesse = MAX_KI_ZUTATEN): number[][] {
  const portionen: number[][] = [];
  for (let start = 0; start < ids.length; start += groesse)
    portionen.push(ids.slice(start, start + groesse));
  return portionen;
}
