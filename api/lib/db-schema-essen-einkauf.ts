import type { ColumnType, Generated } from 'kysely';
import type { ReadOnly, SqlDate } from './db-schema-types';
import type { GerichtEinheit } from './essen-gerichte-model';

export interface EssenGeschaeftTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  position: number;
  name: string;
}

/** `essen.bestand` and `essen.zusatzbedarf`: an amount of an ingredient of the Planung. */
export interface EssenPostenTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  planung_zutat_id: number;
  /** decimal(12, 3). */
  menge: number;
  einheit: GerichtEinheit;
  hinweis: Generated<string>;
}

/** A thing to pack: a tool of the planned dishes with its state, or an entry of its own. */
export interface EssenPacklisteEintragTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  /** The normalized name of a tool of the dishes; null for an entry of its own. */
  werkzeug: string | null;
  name: string;
  /** The whole entry: its one box, or with persons assigned whether all of them packed. */
  gepackt: Generated<boolean>;
  /** Not read any more since `0076` (`essen.packliste_zuteilung`); dropped later. */
  zustaendig_mitglied_id: Generated<number | null>;
  /** Not read any more since `0076`; dropped later. */
  zustaendig_text: Generated<string>;
}

/** `essen.packliste_zuteilung` (`0076`): a person who packs an entry, with their own box. */
export interface EssenPacklisteZuteilungTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  eintrag_id: number;
  /** A member of the Planung, or null for a free name. */
  mitglied_id: number | null;
  /** The free name; empty for a member. */
  name: Generated<string>;
  gepackt: Generated<boolean>;
}

/** `essen.beleg_ordner_loeschen`: photo folders of deleted Planungen still to clean up (`0072`). */
export interface EssenBelegOrdnerLoeschenTable {
  planung_id: number;
  angelegt_am: Generated<Date>;
}

/** `essen.beleg_ordner`: Planungen that ever stored a receipt photo (`0073`). */
export interface EssenBelegOrdnerTable {
  planung_id: number;
  angelegt_am: Generated<Date>;
}

/** `essen.beleg`: a receipt of a Planung, who paid it and whether it was paid back (`0071`). */
export interface EssenBelegTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  datum: SqlDate;
  betrag_cent: number;
  haendler: Generated<string>;
  notiz: Generated<string>;
  /** A member, or null with a free name in `bezahlt_von_text`. */
  bezahlt_von_mitglied_id: number | null;
  bezahlt_von_text: Generated<string>;
  erstattet: Generated<boolean>;
  erstattet_am: Date | null;
  erstattet_von_mitglied_id: number | null;
  /** File name in `essen-belege/<planung_id>/`; null without a photo. */
  foto: string | null;
  angelegt_von_mitglied_id: number | null;
  angelegt_am: Generated<Date>;
}

/** `essen.zusatzbedarf`: like the stock, but an amount is optional („Kochhandschuhe“). */
export interface EssenZusatzbedarfTable extends Omit<EssenPostenTable, 'menge' | 'einheit'> {
  /** decimal(12, 3); null with `einheit` null. */
  menge: number | null;
  einheit: GerichtEinheit | null;
}

/** `essen.einkauf`: a shopping trip of a Planung (`0064`). */
export interface EssenEinkaufTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  position: number;
  name: string;
  datum: SqlDate | null;
  /** null: every shop. */
  geschaeft_id: number | null;
  /** Without a foreign key; null or a deleted meal: all meals. */
  bis_mahlzeit_id: number | null;
  abgeschlossen: Generated<boolean>;
}

/** `essen.einkauf_posten`: what was ticked off on a shopping trip. */
export interface EssenEinkaufPostenTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  einkauf_id: number;
  planung_zutat_id: number;
  einheit: GerichtEinheit;
  /** decimal(12, 3), at least 0. */
  erhalten: number;
  ersatz: Generated<string>;
  abgehakt_von_mitglied_id: number | null;
  abgehakt_am: Generated<Date>;
  /** binary(8): @@DBTS when ticked off (`0074`); null only for rows of before. */
  abgehakt_stand: Buffer | null;
}

/** `essen.einkauf_regel`: a hand-made rule for an ingredient on a shopping trip. */
export interface EssenEinkaufRegelTable {
  id: Generated<number>;
  einkauf_id: number;
  planung_zutat_id: number;
  art: 'ohne' | 'mit' | 'fest';
  /** decimal(12, 3); only with `fest`. */
  menge: number | null;
  einheit: GerichtEinheit | null;
  /** For an `ohne` made by moving: the trip it was moved to (`0066`, no foreign key). */
  verschoben_nach: Generated<number | null>;
}

export interface EssenAenderungTable {
  /** bigint; the driver reads it as a string. */
  id: Generated<string>;
  planung_id: number;
  seq: ColumnType<string, string | number, never>;
  at: Generated<Date>;
  mitglied_id: number | null;
  aktion: string;
  /** JSON object. */
  details: string;
}
