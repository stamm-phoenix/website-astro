import type { Generated } from 'kysely';
import type { ReadOnly, SqlTimeOrNull } from './db-schema-types';
import type {
  AbstimmungMailArt,
  AbstimmungMailStatus,
  AbstimmungSichtbarkeit,
} from './abstimmung-model';

export interface AbstimmungTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  titel: string;
  beschreibung: Generated<string>;
  /** At most this many options with „Ja“; `null`: any number. */
  max_auswahl: number | null;
  /** Options may also be chosen with „Vielleicht“. */
  vielleicht: Generated<boolean>;
  sichtbarkeit: Generated<AbstimmungSichtbarkeit>;
  link_token: string;
  erstellt_von: string;
  erstellt_von_name: string;
  erstellt_am: Generated<Date>;
  geschlossen_am: SqlTimeOrNull;
}

export interface AbstimmungOptionTable {
  id: Generated<number>;
  abstimmung_id: number;
  position: number;
  text: string;
}

export interface AbstimmungTeilnahmeTable {
  id: Generated<number>;
  abstimmung_id: number;
  token: string;
  name: Generated<string>;
  login: string | null;
  email: string | null;
  geantwortet_am: SqlTimeOrNull;
  mail_art: AbstimmungMailArt | null;
  mail_status: AbstimmungMailStatus | null;
  eingeladen_am: SqlTimeOrNull;
  erinnert_am: SqlTimeOrNull;
  erstellt_am: Generated<Date>;
  /** Key of the first answer over the shared link, so a repeated request finds this row. */
  versuch: string | null;
  /** Invitation to an address several CampFlow persons share; holds no answer itself. */
  familie: Generated<boolean>;
  /** Another invitation of the same leader: its link opens and changes that participation. */
  alias_von: number | null;
}

export interface AbstimmungStimmeTable {
  teilnahme_id: number;
  option_id: number;
  /** Chosen with „Vielleicht“ instead of „Ja“. */
  vielleicht: Generated<boolean>;
}
