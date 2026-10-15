// Deadlines for the KJR's grant: the Abrechnung of an Aktion has to be handed in within three
// months after its last day (Leitendenbereich start page and Abrechnung).
import type { CampflowEvent } from './types';

/** Months after the end of an Aktion until its Abrechnung has to be at the KJR. */
export const KJR_ABGABE_MONATE = 3;
/** From this many days before the deadline on, it is highlighted. */
export const KJR_FRIST_BALD_TAGE = 14;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The same day `months` later than `date` (`YYYY-MM-DD`), or the last day of that month if it is
 * shorter (30.11. + 3 → 28./29.02.).
 */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** The deadline for an Aktion ending on `endDate` (`YYYY-MM-DD`): three months later. */
export function kjrAbgabefrist(endDate: string): string {
  return addMonths(endDate, KJR_ABGABE_MONATE);
}

/** Days from `today` to `date` (both `YYYY-MM-DD`); 0 on the day itself. */
export function tageBis(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export interface KjrFristStand {
  /** Last day of the Aktion (`YYYY-MM-DD`). */
  ende: string;
  /** Deadline (`YYYY-MM-DD`). */
  frist: string;
  /** Days until the deadline; negative once it has passed. */
  tage: number;
  /** The Aktion is over, so the Abrechnung can be handed in. */
  vorbei: boolean;
  /** The Aktion is over and the deadline is at most `KJR_FRIST_BALD_TAGE` days away. */
  bald: boolean;
}

/** The deadline of an Aktion on `today`, or `null` without a valid date. */
export function kjrFristStand(
  event: Pick<CampflowEvent, 'start_date' | 'end_date'>,
  today: string
): KjrFristStand | null {
  const ende = (event.end_date ?? event.start_date ?? '').slice(0, 10);
  if (!DATE_PATTERN.test(ende)) return null;
  const frist = kjrAbgabefrist(ende);
  const tage = tageBis(frist, today);
  const vorbei = ende < today;
  return { ende, frist, tage, vorbei, bald: vorbei && tage >= 0 && tage <= KJR_FRIST_BALD_TAGE };
}

/** The time left until a deadline that has not passed: „heute“, „morgen“, „noch 5 Tage“. */
export function kjrRestzeit(tage: number): string {
  if (tage === 0) return 'heute';
  if (tage === 1) return 'morgen';
  return `noch ${tage} Tage`;
}

export interface KjrFrist extends KjrFristStand {
  event: CampflowEvent;
}

/**
 * Aktionen that are over and whose deadline has not passed yet, the earliest deadline first.
 * Archived Aktionen count as well: archiving in CampFlow does not mean the grant was applied for.
 * Aktionen without KJR grant have no deadline.
 */
export function offeneKjrFristen(events: CampflowEvent[], today: string): KjrFrist[] {
  return events
    .filter((event) => event.zuschussfaehig)
    .flatMap((event) => {
      const stand = kjrFristStand(event, today);
      if (!stand?.vorbei || stand.tage < 0) return [];
      return [{ event, ...stand }];
    })
    .sort(
      (a, b) => a.frist.localeCompare(b.frist) || a.event.title.localeCompare(b.event.title, 'de')
    );
}
