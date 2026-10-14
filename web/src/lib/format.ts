/** Formatting of money, dates and times, shared across the site. */

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** A cent amount as euros, e.g. `12,50 €`. */
export function formatEuro(cent: number): string {
  return EURO.format(cent / 100);
}
