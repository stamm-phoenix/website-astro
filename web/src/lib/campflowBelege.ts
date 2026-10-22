import { belegEintraege } from './belegEintraege';
import type { StatusTone } from './status';
import type { CampflowBelegeData, StaffBeleg } from './types';

/** One line of the box „Meine Belege“ on the start page. */
export interface MeinBeleg {
  key: string;
  title: string;
  /** Belegdatum `YYYY-MM-DD`, or the day of upload; `''` if unknown. */
  date: string;
  /** The amount, positive. */
  amountCent: number;
  label: string;
  tone: StatusTone;
}

/**
 * The receipts of the logged-in user, newest first: the ones submitted here with their review
 * state, and the ones in CampFlow they submitted here or paid out of pocket, with their booking
 * and payment state. `campflow` may still be loading (`null`).
 */
export function meineBelege(
  belege: readonly StaffBeleg[],
  campflow: CampflowBelegeData | null,
  login: string,
  isIch: (person: { name: string }) => boolean
): MeinBeleg[] {
  return belegEintraege(belege, campflow, { login, isIch })
    .filter((eintrag) => eintrag.own)
    .map(({ key, title, date, amountCent, label, tone }) => ({
      key,
      title,
      date,
      amountCent,
      label,
      tone,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
