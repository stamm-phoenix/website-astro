import type { ColumnType, Generated } from 'kysely';
import type { ReadOnly, SqlDate } from './db-schema-types';
import type { EssenEinheitenart } from './essen-validation';
import type { GerichtEinheit } from './essen-gerichte-model';

/** A request to create a Planung, confirmed by the link in a mail. */
export interface EssenAnlageAnfrageTable {
  id: Generated<number>;
  token_hash: string;
  email: string;
  name: string;
  planung_name: string;
  erster_tag: SqlDate;
  letzter_tag: SqlDate;
  erstellt_am: Generated<Date>;
  laeuft_ab: Date;
  planung_id: number | null;
}

export interface EssenPlanungTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  name: string;
  mitglieder_verwalten: Generated<boolean>;
  beitritt_token: string | null;
  lese_token: string | null;
  /** bigint; the driver reads it as a string. */
  aenderung_seq: ColumnType<string, never, string>;
  erstellt_am: Generated<Date>;
  geaendert_am: Generated<Date>;
}

export interface EssenMitgliedTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  name: string;
  email: string | null;
  rolle: 'besitzer' | 'bearbeiten';
  token_hash: string | null;
  erstellt_am: Generated<Date>;
  link_gesendet_am: Date | null;
  entzogen_am: Date | null;
  /** The deletion date the owner was warned about (retention). */
  loeschwarnung_fuer: SqlDate | null;
}

/** A member's second token for opening the Planung from the Leitendenbereich (`0078`). */
export interface EssenLeitungLinkTable {
  mitglied_id: number;
  token: string;
  erstellt_am: Generated<Date>;
}

/** When a member first opened the Planung; without a row it is an invitation (`0079`). */
export interface EssenMitgliedGeoeffnetTable {
  mitglied_id: number;
  am: Generated<Date>;
}

export interface EssenTagTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  datum: SqlDate;
}

export interface EssenMahlzeitTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  tag_id: number;
  position: number;
  name: string;
  /** `HH:MM`. */
  uhrzeit: string | null;
}

export interface EssenPlanungZutatTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  /** null: an ingredient of the Planung's own. */
  zutat_id: number | null;
  name: string | null;
  kategorie_id: number | null;
  einheitenart: EssenEinheitenart | null;
  vegetarisch: boolean | null;
  vegan: boolean | null;
  /** Where it is bought; null: no shop yet. */
  geschaeft_id: Generated<number | null>;
  /** Only for ingredients of the Planung's own; central ones take the value of the list. */
  lebensmittel: Generated<boolean>;
}

export interface EssenPlanungZutatUnvertraeglichkeitTable {
  planung_zutat_id: number;
  unvertraeglichkeit_id: number;
}

export interface EssenEinplanungTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  mahlzeit_id: number;
  gericht_id: number;
  position: number;
  /** decimal(6, 3). */
  faktor: number;
  zustaendig_mitglied_id: number | null;
  zustaendig_text: Generated<string>;
  status: Generated<EinplanungStatus>;
}

export type EinplanungStatus = 'offen' | 'gekocht' | 'ausgelassen';

/** What a cooked dish used, per ingredient and unit. */
export interface EssenEinplanungVerbrauchTable {
  id: Generated<number>;
  einplanung_id: number;
  planung_zutat_id: number;
  /** decimal(12, 3), at least 0. */
  menge: number;
  einheit: GerichtEinheit;
}

export interface EssenPlanungGruppeTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  position: number;
  name: string;
  /** decimal(4, 2). */
  faktor: number;
}

export interface EssenTeilnehmendeTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  gruppe_id: number;
  ernaehrung: 'alles' | 'vegetarisch' | 'vegan';
  anzahl: number;
  von_mahlzeit_id: number | null;
  bis_mahlzeit_id: number | null;
  hinweis: Generated<string>;
}

export interface EssenTeilnehmendeUnvertraeglichkeitTable {
  teilnehmende_id: number;
  unvertraeglichkeit_id: number;
}

export interface EssenMahlzeitOhneGruppeTable {
  mahlzeit_id: number;
  gruppe_id: number;
}
