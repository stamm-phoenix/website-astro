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
  /** Invited and never opened since. */
  neu: boolean;
}

/**
 * The name a Leitende:r gets as owner of a Planung created from the Leitendenbereich: the full
 * name from the login if there is one, otherwise from the address („kim.kueche@…“ →
 * „Kim Kueche“). It can be changed in the Planung like every member's name.
 */
export function anzeigeName(login: string, vollerName?: string): string {
  const name = vollerName?.trim().replace(/\s+/g, ' ');
  if (name) return name.slice(0, 100);
  const teile = (login.split('@')[0] ?? '')
    .split(/[._-]+/)
    .filter(Boolean)
    .map((teil) => teil.charAt(0).toUpperCase() + teil.slice(1));
  return (teile.join(' ') || login).slice(0, 100);
}
