/**
 * Types of the module „Inventur“ (#107), shared with the frontend, so keep it free of
 * Node-specific imports.
 */

export const INVENTAR_KATEGORIEN = ['kleidung', 'aufnaeher', 'zelt', 'lager'] as const;
export type InventarKategorie = (typeof INVENTAR_KATEGORIEN)[number];

export const INVENTAR_ZUSTAENDE = ['gut', 'gebrauchsspuren', 'reparatur', 'defekt'] as const;
export type InventarZustand = (typeof INVENTAR_ZUSTAENDE)[number];

export const INVENTAR_MAX_VARIANTEN = 60;
export const INVENTAR_MAX_BESTAND = 1_000_000;

/** A size or motif with its stock. */
export interface InventarVariante {
  id: number;
  /** Size or motif; empty for an article without variants. */
  bezeichnung: string;
  bestand: number;
  /** ISO time of the last count, or `null` if never counted. */
  gezaehltAm: string | null;
  gezaehltVon: string | null;
}

export interface InventarArtikel {
  id: number;
  bezeichnung: string;
  kategorie: InventarKategorie;
  einheit: string;
  lagerort: string;
  zustand: InventarZustand;
  /** Accessories, mainly of tents. */
  zubehoer: string;
  /** Missing or damaged parts; empty if nothing is missing. */
  fehlend: string;
  notizen: string;
  varianten: InventarVariante[];
  /** Sum over all variants. */
  bestand: number;
  etag: string;
  updatedAt: string;
  updatedBy: string;
}

/** A variant to save; `id` is `null` for a new one. */
export interface InventarVarianteInput {
  id: number | null;
  bezeichnung: string;
  bestand: number;
}

export type InventarArtikelInput = Pick<
  InventarArtikel,
  | 'bezeichnung'
  | 'kategorie'
  | 'einheit'
  | 'lagerort'
  | 'zustand'
  | 'zubehoer'
  | 'fehlend'
  | 'notizen'
> & { varianten: InventarVarianteInput[] };

/** The counted stock of every variant of an article. */
export interface InventarZaehlungInput {
  varianten: { id: number; bestand: number }[];
}

/** Whether the article needs repair or has missing or damaged parts. */
export function brauchtAufmerksamkeit(
  artikel: Pick<InventarArtikel, 'zustand' | 'fehlend'>
): boolean {
  return artikel.zustand === 'reparatur' || artikel.zustand === 'defekt' || !!artikel.fehlend;
}
