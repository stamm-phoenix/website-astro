import type { EssenEinheitenart } from './essen-schema';

/**
 * The central list and the ingredients of the Planungen (`docs/essensplanung.md`, „Zentrale
 * Zutatenliste“): own ingredients of Planungen to take over, and duplicates of the list to merge.
 * Types without zod, so the browser imports them.
 */

/** Own ingredients of the same name (upper and lower case alike) in one or more Planungen. */
export interface PlanungsZutat {
  name: string;
  /** The ingredients of the Planungen (`planung_zutat`) with this name. */
  ids: number[];
  /** The names of their Planungen. */
  planungen: string[];
  /** The values of the most recently added one. */
  kategorieId: number;
  einheitenart: EssenEinheitenart;
  lebensmittel: boolean;
  vegetarisch: boolean | null;
  vegan: boolean | null;
  allergene: number[];
  /** Category and kind of unit are guesses (added with only the name). */
  angabenOffen: boolean;
  /** The central ingredient of the same name, when the list has one meanwhile. */
  zentralId: number | null;
}

/** Central ingredients the AI takes for one and the same; `behalten` is the one to keep. */
export interface DoppelteZutaten {
  ids: number[];
  behalten: number;
  grund: string;
}

export interface KiDoppelte {
  gruppen: DoppelteZutaten[];
}
