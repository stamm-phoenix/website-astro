import type { ColumnType, Generated } from 'kysely';
import type { InventarKategorie, InventarZustand } from './inventur-model';

/** Set by the database (rowversion); never written by the code. */
type ReadOnly<T> = ColumnType<T, never, never>;

/** An article of the Inventur (migration 0067); its stock lives in the variants. */
export interface InventarArtikelTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  bezeichnung: string;
  kategorie: InventarKategorie;
  einheit: Generated<string>;
  lagerort: Generated<string>;
  zustand: Generated<InventarZustand>;
  zubehoer: Generated<string>;
  fehlend: Generated<string>;
  notizen: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: string;
}

/** A size or motif of an article with its stock; an article without one has a single empty one. */
export interface InventarVarianteTable {
  id: Generated<number>;
  artikel_id: number;
  bezeichnung: Generated<string>;
  bestand: Generated<number>;
  sortierung: Generated<number>;
  gezaehlt_am: Generated<Date | null>;
  gezaehlt_von: Generated<string | null>;
}
