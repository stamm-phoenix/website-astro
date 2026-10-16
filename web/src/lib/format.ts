/** Formatting of money, dates and times, shared across the site. */

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** A cent amount as euros, e.g. `12,50 €`. */
export function formatEuro(cent: number): string {
  return EURO.format(cent / 100);
}

const DATE_TIME = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
});

/** A point in time in Berlin time, e.g. `14.10.2026, 15:30`. */
export function formatDateTime(value: string | Date): string {
  return DATE_TIME.format(typeof value === 'string' ? new Date(value) : value);
}

const ISO_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' });

/** Today in Berlin as `YYYY-MM-DD`, the format of date inputs. */
export function todayIso(): string {
  return ISO_DAY.format(new Date());
}

/**
 * The day of a date or point in time in Berlin as `YYYY-MM-DD`; a plain date stays as it is.
 * CampFlow sends both, e.g. `2025-12-31T23:30:00Z` is the 1 January 2026 in Berlin.
 */
export function berlinDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : ISO_DAY.format(date);
}
