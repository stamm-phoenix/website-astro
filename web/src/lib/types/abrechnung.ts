/** Abrechnung of an Aktion, the sums of the Kostenstellen and the Belege. */
import type { AbrechnungPerson, KategorieSumme, Nachweis } from '../../../../api/lib/abrechnung';
import type { CampflowBeleg } from '../../../../api/lib/campflow-belege-model';
import type { KostenstelleStatistik } from '../../../../api/lib/kostenstellen-model';
import type { CampflowEvent } from './aktionen';

/** Financial overview of an Aktion (Leitendenbereich → Abrechnung). */
export interface Abrechnung {
  event: Pick<
    CampflowEvent,
    'id' | 'title' | 'start_date' | 'end_date' | 'zuschussfaehig' | 'keineAktion'
  >;
  costUnit: { id: string; name: string };
  /** Confirmed registrations, only the fields relevant for the Abrechnung. */
  persons: AbrechnungPerson[];
  /**
   * IDs of the own registrations, matched on the server by address (`docs/personen.md`); `null`
   * when it could not compare, then the names decide.
   */
  ich?: string[] | null;
  bilanz: {
    incomeCent: number;
    /** Positive sum of all expenses. */
    expenseCent: number;
    resultCent: number;
    income: KategorieSumme[];
    expenses: KategorieSumme[];
    entryCount: number;
  };
  nachweise: Nachweis[];
  /** When the Einzelnachweise were exported from CampFlow (ISO 8601); null if unknown. */
  exportedAt: string | null;
  /** Fees for the Stamm's tents and material, set in the API's config. */
  leihgebuehren: LeihgebuehrenTarif;
}

export interface LeihgebuehrenTarif {
  /** Who decided the fees, e.g. „e.V.-Versammlung“. */
  beschlossenVon: string;
  /** Date of that decision (YYYY-MM-DD). */
  stand: string;
  material: { id: string; name: string; priceCentPerDay: number }[];
}

export interface CampflowBelegeData {
  /** When the receipts were read from CampFlow (ISO 8601). */
  loadedAt: string;
  costUnits: {
    id: string;
    name: string;
    archived: boolean;
    categories: { id: string; name: string }[];
  }[];
  belege: CampflowBeleg[];
}

/** Sums per CampFlow Kostenstelle and Kategorie (`GET /api/intern/kostenstellen/summen`). */
export interface KostenstellenData {
  /** When CampFlow's report was exported (ISO 8601). */
  loadedAt: string;
  costUnits: KostenstelleStatistik[];
}
