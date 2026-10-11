// Deadlines for the KJR's grant: the Abrechnung of an Aktion has to be handed in within three
// months after its last day (Leitendenbereich, start page).
import type { CampflowEvent } from './types';

/** Months after the end of an Aktion until its Abrechnung has to be at the KJR. */
export const KJR_ABGABE_MONATE = 3;
/** From this many days before the deadline on, it is highlighted. */
export const KJR_FRIST_BALD_TAGE = 14;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The deadline for an Aktion ending on `endDate` (`YYYY-MM-DD`): the same day three months
 * later, or the last day of that month if it is shorter (30.11. → 28./29.02.).
 */
export function kjrAbgabefrist(endDate: string): string {
  const [year, month, day] = endDate.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + KJR_ABGABE_MONATE, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Days from `today` to `date` (both `YYYY-MM-DD`); 0 on the day itself. */
export function tageBis(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export interface KjrFrist {
  event: CampflowEvent;
  /** Last day of the Aktion (`YYYY-MM-DD`). */
  ende: string;
  /** Deadline (`YYYY-MM-DD`). */
  frist: string;
  tage: number;
  bald: boolean;
}

/**
 * Aktionen that are over and whose deadline has not passed yet, the earliest deadline first.
 * Archived Aktionen count as well: archiving in CampFlow does not mean the grant was applied for.
 */
export function offeneKjrFristen(events: CampflowEvent[], today: string): KjrFrist[] {
  return events
    .flatMap((event) => {
      const ende = (event.end_date ?? event.start_date ?? '').slice(0, 10);
      if (!DATE_PATTERN.test(ende) || ende >= today) return [];
      const frist = kjrAbgabefrist(ende);
      const tage = tageBis(frist, today);
      if (tage < 0) return [];
      return [{ event, ende, frist, tage, bald: tage <= KJR_FRIST_BALD_TAGE }];
    })
    .sort(
      (a, b) => a.frist.localeCompare(b.frist) || a.event.title.localeCompare(b.event.title, 'de')
    );
}
