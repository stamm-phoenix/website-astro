import type { ColumnType, Generated } from 'kysely';
import type { VerleihStatus } from './verleih-model';
export interface VerleihTable {
  id: Generated<number>;
  version: ColumnType<Buffer, never, never>;
  anfrage_id: Generated<string>;
  anfrage_hash: Generated<string>;
  status: VerleihStatus;
  antragsteller: string;
  entleiher: string;
  kontakt: string;
  verantwortlich: string;
  von: string;
  bis: string;
  notizen: string;
  entscheidung: Generated<string>;
  entschieden_von: Generated<string>;
}
export interface VerleihPositionTable {
  id: Generated<number>;
  verleih_id: number;
  variante_id: number;
  bezeichnung: string;
  menge: number;
  zurueck: Generated<number>;
}
export interface VerleihVerlaufTable {
  id: Generated<number>;
  verleih_id: number;
  am: Generated<Date>;
  von: string;
  text: string;
}
export interface VerleihMailTable {
  id: Generated<number>;
  verleih_id: number;
  empfaenger: string;
  betreff: string;
  text: string;
  gesendet: Generated<boolean>;
}
export interface VerleihEinstellungTable {
  id: number;
  version: ColumnType<Buffer, never, never>;
  materialwart: Generated<string>;
}
