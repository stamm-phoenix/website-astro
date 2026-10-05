import type { CampflowEvent, StaffAktion } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Planned dates often move a bit until the CampFlow event is created. */
const NEAR_DAYS = 14;

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

/**
 * Whether a calendar entry created without CampFlow probably belongs to a CampFlow event: same
 * start date, one title contains the other, or a shared word with dates close together.
 */
export function isLikelyMatch(event: CampflowEvent, entry: StaffAktion): boolean {
  if (event.start_date && event.start_date === entry.start) return true;

  const eventTitle = normalize(event.title);
  const entryTitle = normalize(entry.title);
  if (
    eventTitle.length >= 4 &&
    entryTitle.length >= 4 &&
    (eventTitle.includes(entryTitle) || entryTitle.includes(eventTitle))
  ) {
    return true;
  }

  if (!event.start_date || !entry.start || daysApart(event.start_date, entry.start) > NEAR_DAYS) {
    return false;
  }
  const entryWords = words(entry.title);
  return [...words(event.title)].some((word) => entryWords.has(word));
}
