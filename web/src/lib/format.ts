/** Formatting of money, dates and times, shared across the site. */
import { berlinDay as berlinToday } from '../../../api/lib/dates';
import { formatEuro } from '../../../api/lib/money';

export { formatEuro };

/** A missing amount stays visibly unset; each flow can name what remains open. */
export function formatOptionalEuro(cent: number | null, pending = 'Noch offen'): string {
  return cent === null ? pending : formatEuro(cent);
}

const DATE_TIME = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
});

/** A point in time in Berlin time, e.g. `14.10.2026, 15:30`. */
export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '' : DATE_TIME.format(date);
}

/** Whether the point in time falls on today's date in Berlin. */
export function isToday(value: string | Date | number): boolean {
  return berlinToday(new Date(value)) === berlinToday();
}

/** Today in Berlin as `YYYY-MM-DD`, the format of date inputs. */
export function todayIso(): string {
  return berlinToday();
}

/**
 * The day of a date or point in time in Berlin as `YYYY-MM-DD`; a plain date stays as it is.
 * CampFlow sends both, e.g. `2025-12-31T23:30:00Z` is the 1 January 2026 in Berlin.
 */
export function berlinDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : berlinToday(date);
}

const CLOCK = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Berlin',
});

/** A point in time as HH:MM in Berlin, independent of the device's time zone. */
export function formatClock(value: string | Date | number): string {
  return CLOCK.format(typeof value === 'string' ? new Date(value) : value);
}

/** A calendar date or timestamp in Berlin; date-only strings never shift to the previous day. */
export function formatDay(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  return new Intl.DateTimeFormat('de-DE', { ...options, timeZone: 'Europe/Berlin' }).format(
    typeof value === 'string' ? new Date(value) : value
  );
}
