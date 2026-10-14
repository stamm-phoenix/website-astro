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
