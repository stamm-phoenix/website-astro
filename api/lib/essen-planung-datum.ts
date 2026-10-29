import { isValidDate } from './calendar-date';

/** Calendar days of a Planung of the Essensplanung, shared by its rules and its schemas. */

/** At most this many days per Planung; a camp of two weeks with buffer. */
export const MAX_TAGE = 60;

/** A valid calendar date `YYYY-MM-DD`, or undefined. */
export function readDatum(value: unknown): string | undefined {
  return typeof value === 'string' && isValidDate(value) ? value : undefined;
}

export function addDays(datum: string, days: number): string {
  const date = new Date(`${datum}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (24 * 60 * 60_000)
  );
}

/** The day a Planung is deleted: its last day plus the retention in months. */
export function loeschDatum(letzterTag: string, monate: number): string {
  const date = new Date(`${letzterTag}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + monate);
  // The 31st becomes the last day of a shorter month
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}
