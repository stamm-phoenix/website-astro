/** Essensplanung. */
import type { EssenEinheitenart, EssenEinstellungen } from '../../../../api/lib/essen-schema';
import type {
  EssenAuditEntry,
  EssenKategorie,
  EssenPlanungUebersicht,
  EssenUnvertraeglichkeit,
  EssenZutat,
} from '../../../../api/lib/essen-validation';

export interface EssenVorlageGruppe {
  name: string;
  faktor: number;
}

export interface EssenZutatInput {
  name: string;
  kategorieId: number;
  einheitenart: EssenEinheitenart;
  abtropfgewicht: boolean;
  lebensmittel: boolean;
  /** null: not known yet. */
  vegetarisch: boolean | null;
  vegan: boolean | null;
  merkmaleGeprueft: boolean;
  hinweis: string;
  grammProTl: number | null;
  grammProEl: number | null;
  grammProStueck: number | null;
  allergene: number[];
}

export interface StaffEssenSteuerung {
  einstellungen: EssenEinstellungen;
  etag: string;
  updatedAt: string;
  updatedBy: string;
  kategorien: EssenKategorie[];
  unvertraeglichkeiten: EssenUnvertraeglichkeit[];
  zutaten: EssenZutat[];
  planungen: EssenPlanungUebersicht[];
  log: EssenAuditEntry[];
}
