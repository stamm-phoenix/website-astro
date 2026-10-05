import type { CampflowEvent, StaffAktion } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Planned dates often move a bit until the CampFlow event is created, but an Aktion of the same
 * name in another year must not match: with dates on both sides the title alone never counts.
 */
const SAME_TITLE_DAYS = 30;
const SHARED_WORD_DAYS = 14;

function normalize(text: string): string {
  return text
    .toLocaleLowerCase('de')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function words(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(' ')
      .filter((word) => word.length >= 4)
  );
}

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
}

/** Days between two `YYYY-MM-DD` dates; `Infinity` if one is missing. */
export function dateDistance(a: string | null | undefined, b: string | null | undefined): number {
  return a && b ? daysApart(a, b) : Infinity;
}

/**
 * Whether a calendar entry created without CampFlow probably belongs to a CampFlow event. The date
 * decides: same start date; or one title contains the other with at most 30 days in between; or a
 * shared word with at most 14 days in between. Only if a side has no date does the title alone
 * count.
 */
export function isLikelyMatch(event: CampflowEvent, entry: StaffAktion): boolean {
  const eventTitle = normalize(event.title);
  const entryTitle = normalize(entry.title);
  const sameTitle =
    eventTitle.length >= 4 &&
    entryTitle.length >= 4 &&
    (eventTitle.includes(entryTitle) || entryTitle.includes(eventTitle));

  if (!event.start_date || !entry.start) return sameTitle;

  const days = daysApart(event.start_date, entry.start);
  if (days === 0) return true;
  if (sameTitle) return days <= SAME_TITLE_DAYS;
  if (days > SHARED_WORD_DAYS) return false;
  const entryWords = words(entry.title);
  return [...words(event.title)].some((word) => entryWords.has(word));
}
