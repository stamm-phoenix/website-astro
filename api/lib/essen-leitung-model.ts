import type { PlanungRolle } from './essen-planung-model';

/**
 * Types and rules of opening Planungen from the Leitendenbereich (`essen-leitung.ts`), without
 * database access, so the website and its mock API can use them too.
 */

export const STAMM_DOMAIN = 'stamm-phoenix.de';

/** Whether the address belongs to the Stamm (`…@stamm-phoenix.de`). */
export function istStammAdresse(email: string): boolean {
  return email.trim().toLowerCase().split('@')[1] === STAMM_DOMAIN;
}

/** A Planung in the list of the Leitendenbereich. */
export interface LeitungPlanung {
  planungId: number;
  name: string;
  rolle: PlanungRolle;
  /** `YYYY-MM-DD`; null while the Planung has no days. */
  ersterTag: string | null;
  letzterTag: string | null;
  /** The token for `/essensplanung/planung#t=…`. */
  token: string;
}
