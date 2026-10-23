import { belegEintraege, type BelegEintrag } from './belegEintraege';
import { todayIso } from './format';
import type { StatusTone } from './status';
import type { CampflowBelegeData, StaffBeleg } from './types';

/** How many days a paid-back receipt stays in „Meine Belege“ on the start page. */
export const MEINE_BELEGE_ERSTATTET_TAGE = 30;

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

/** `YYYY-MM-DD` that many days before `day`. */
function daysBefore(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Whether a receipt still belongs on the start page: everything not paid back yet, and what was
 * paid back in the last `MEINE_BELEGE_ERSTATTET_TAGE` days. Older ones stay in the module. One
 * paid back on an unknown day stays, so it never vanishes right after being paid back.
 */
function stillCurrent(eintrag: BelegEintrag, today: string): boolean {
  if (eintrag.stand !== 'bezahlt' || !eintrag.settledAt) return true;
  return eintrag.settledAt >= daysBefore(today, MEINE_BELEGE_ERSTATTET_TAGE);
}

/**
 * The receipts the logged-in user paid out of pocket that are not paid back yet or were paid back
 * recently, newest first: the ones here with their review state and the ones in CampFlow with
 * their booking and payment state, whoever submitted them. `campflow` may still be loading
 * (`null`). `today` is the day in Berlin as `YYYY-MM-DD`.
 */
export function meineBelege(
  belege: readonly StaffBeleg[],
  campflow: CampflowBelegeData | null,
  isIch: (person: { name: string }) => boolean,
  today: string = todayIso()
): MeinBeleg[] {
  return belegEintraege(belege, campflow, { isIch })
    .filter((eintrag) => eintrag.own && stillCurrent(eintrag, today))
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
