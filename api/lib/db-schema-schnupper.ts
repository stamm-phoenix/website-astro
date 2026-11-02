import type { ColumnType, Generated } from 'kysely';
import type { SchnupperStatus, SchnupperStufe } from './schnupper-model';

/** Set by the database (rowversion); never written by the code. */
type ReadOnly<T> = ColumnType<T, never, never>;

/** A Schnupperstunden-Anfrage (`organisation.schnupper_anfrage`, migration 0070). */
export interface SchnupperAnfrageTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  created_at: Generated<Date>;
  alter_jahre: number;
  stufe: SchnupperStufe;
  kind_vorname: Generated<string>;
  kontakt_name: string;
  email: string;
  telefon: Generated<string>;
  wunschzeit: string;
  nachricht: Generated<string>;
  status: Generated<SchnupperStatus>;
  /** `date` column; read as a `Date` at midnight UTC. */
  termin_datum: ColumnType<Date | string | null, string | null, string | null>;
  termin_zeit: string | null;
  termin_ort: Generated<string>;
  antwort: Generated<string>;
  antwort_mail: Generated<boolean | null>;
  bearbeitet_von: Generated<string | null>;
  bearbeitet_am: Generated<Date | null>;
}
