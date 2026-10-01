/** Small helpers shared by the mock data modules. */

const DAY_MS = 24 * 60 * 60_000;

/** `YYYY-MM-DD` of today plus `days` (local time of the dev machine). */
export function dayFromToday(days: number): string {
  const date = new Date(Date.now() + days * DAY_MS);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** ISO timestamp `days` (may be fractional) from now. */
export function isoFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

let etagCounter = 1;

/** A SharePoint-like quoted etag, e.g. `"4f0c…,3"`. */
export function newEtag(id: string): string {
  return `"mock-${id},${etagCounter++}"`;
}

let idCounter = 900;

/** A fresh numeric id for created items. */
export function newId(): string {
  return String(idCounter++);
}

/** Visible text of an HTML fragment, with blocks separated by spaces. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short hex fingerprint of a string (not cryptographic, only to detect changes). */
export function fingerprint(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b + value.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** `YYYY-MM-DD` of the first `weekday` (0 = Sunday … 6 = Saturday) at least `days` from today. */
export function weekdayFromToday(days: number, weekday: number): string {
  const date = new Date(Date.now() + days * DAY_MS);
  date.setDate(date.getDate() + ((weekday - date.getDay() + 7) % 7));
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Day after `date` plus `days` (for multi-day Aktionen). */
export function plusDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Dates of the Aktionen, relative to today but on sensible weekdays (shared with CampFlow). */
export const AKTION_DATES = {
  stavo: weekdayFromToday(-16, 5),
  leiterrunde: weekdayFromToday(3, 3),
  woe: weekdayFromToday(7, 5),
  hike: weekdayFromToday(14, 6),
  kochabend: weekdayFromToday(19, 2),
  friedenslicht: weekdayFromToday(74, 0),
  winter: weekdayFromToday(100, 4),
  fasching: weekdayFromToday(133, 5),
  georg: weekdayFromToday(198, 6),
  pfingst: weekdayFromToday(236, 6),
  sola: weekdayFromToday(-62, 6),
};
