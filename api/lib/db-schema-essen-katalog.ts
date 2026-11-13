import type { ColumnType, Generated } from 'kysely';
import type { ReadOnly } from './db-schema-types';
import type { EssenEinheitenart } from './essen-validation';
import type { GerichtEinheit } from './essen-gerichte-model';

/** The one row with the switches and templates of the Essensplanung (`docs/essensplanung.md`). */
export interface EssenEinstellungenTable {
  id: number;
  version: ReadOnly<Buffer>;
  anlegen_extern: boolean;
  /** JSON array of addresses and domains. */
  whitelist: string;
  aufbewahrung_monate: number;
  wartung: boolean;
  /** JSON array of `{ name, faktor }`. */
  vorlage_gruppen: string;
  /** JSON array of names. */
  vorlage_mahlzeiten: string;
  updated_at: Generated<Date>;
  updated_by: string;
}

/** The one row that counts every change of the central lists (`0088`). */
export interface EssenKatalogStandTable {
  id: number;
  seq: ColumnType<string, never, string>;
}

export interface EssenKategorieTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  name: string;
}

export interface EssenUnvertraeglichkeitTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  /** Fixed key of the 14 EU allergens; null for the ones added in the Steuerung. */
  schluessel: string | null;
  name: string;
}

export interface EssenZutatTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  name: string;
  kategorie_id: number;
  einheitenart: EssenEinheitenart;
  abtropfgewicht: Generated<boolean>;
  lebensmittel: Generated<boolean>;
  vegetarisch: boolean | null;
  vegan: boolean | null;
  merkmale_geprueft: Generated<boolean>;
  hinweis: Generated<string>;
  /** decimal; the driver reads it as a number. */
  gramm_pro_tl: number | null;
  gramm_pro_el: number | null;
  gramm_pro_stueck: number | null;
  geaendert_am: Generated<Date>;
  geaendert_von: string;
}

export interface EssenZutatUnvertraeglichkeitTable {
  zutat_id: number;
  unvertraeglichkeit_id: number;
}

export interface EssenGerichtTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  name: string;
  /** `NULL`: no reference number of people yet (`0075`). */
  personen: number | null;
  anleitung: Generated<string>;
  notiz: Generated<string>;
  /** JSON array of `{ titel, url }`. */
  links: Generated<string>;
  /** JSON array of names. */
  werkzeuge: Generated<string>;
}

export interface EssenGerichtZutatTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  gericht_id: number;
  position: number;
  planung_zutat_id: number;
  /** decimal(12, 3); null without an amount. */
  menge: number | null;
  einheit: GerichtEinheit | null;
  fest: Generated<boolean>;
  fuer_alles: boolean;
  fuer_vegetarisch: boolean;
  fuer_vegan: boolean;
  hinweis: Generated<string>;
}

export interface EssenGerichtZutatUnvertraeglichkeitTable {
  gericht_zutat_id: number;
  unvertraeglichkeit_id: number;
  /** false: „nicht für …“, true: „nur für …“. */
  nur: boolean;
}
