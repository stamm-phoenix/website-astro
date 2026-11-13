/**
 * Calendar days and German date formats shared by the API and the web. Free of imports, so the web
 * may import it (BROWSER_SAFE_API_MODULES in web/eslint.config.mjs).
 */

const BERLIN = 'Europe/Berlin';
const BERLIN_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: BERLIN });

/** Calendar day `YYYY-MM-DD` in Berlin, independent of the host time zone. */
export function berlinDay(now = new Date()): string {
  return BERLIN_DAY.format(now);
}

/** `day` (`YYYY-MM-DD`) moved by `days`, as `YYYY-MM-DD`. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const DATE_TIME_LONG = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: BERLIN,
});

/** A point in time in Berlin time, e.g. `14. Oktober 2026 um 15:30` (as the runtime writes it). */
export function formatDateTimeLong(value: Date): string {
  return DATE_TIME_LONG.format(value);
}

const DATE_TIME_MEDIUM = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: BERLIN,
});

/** A point in time in Berlin time, e.g. `14.10.2026, 15:30`. */
export function formatDateTimeMedium(value: Date): string {
  return DATE_TIME_MEDIUM.format(value);
}

const DATE_MEDIUM = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: BERLIN });

/** A day or point in time as Berlin date, e.g. `14.10.2026`. */
export function formatDateMedium(value: Date): string {
  return DATE_MEDIUM.format(value);
}
