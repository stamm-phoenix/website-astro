import { berlinDay } from './format';
import type { CampflowEvent, StaffAktion } from './types';

/** An Aktion photos can be uploaded for: from CampFlow or a calendar entry without CampFlow. */
export interface FotoAktion {
  key: string;
  title: string;
  /** Year folder of the photos: of the start, else of the end, else the current year. */
  year: string;
  /** `YYYY-MM-DD` */
  start: string | null;
  end: string | null;
}

/** Aktionen that started up to this many days ago are offered first. */
const RECENT_DAYS = 120;
/** Aktionen starting within this many days also count as recent (photos of the first day). */
const SOON_DAYS = 3;

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * CampFlow events and calendar entries without CampFlow event as one list. Past and running
 * Aktionen come first, newest first, then the coming ones, nearest first; without date last.
 */
export function fotoAktionen(
  events: CampflowEvent[],
  entries: StaffAktion[],
  today: string
): FotoAktion[] {
  const eventIds = new Set(events.map((event) => event.id));
  const year = today.slice(0, 4);
  const items: FotoAktion[] = [
    ...events.map((event) => ({
      key: event.id,
      title: event.title.trim(),
      start: berlinDay(event.start_date),
      end: berlinDay(event.end_date),
    })),
    ...entries
      .filter((entry) => !entry.campflowId || !eventIds.has(entry.campflowId))
      .map((entry) => ({
        key: `kalender-${entry.id}`,
        title: entry.title.trim(),
        start: entry.start || null,
        end: entry.end || null,
      })),
  ]
    .filter((item) => item.title)
    .map((item) => ({ ...item, year: (item.start ?? item.end)?.slice(0, 4) ?? year }));

  const soon = addDays(today, SOON_DAYS);
  const begun = (item: FotoAktion): boolean => (item.start ?? item.end ?? '') <= soon;
  return items.sort((a, b) => {
    const dayA = a.start ?? a.end;
    const dayB = b.start ?? b.end;
    if (!dayA || !dayB) return dayA ? -1 : dayB ? 1 : a.title.localeCompare(b.title, 'de');
    if (begun(a) !== begun(b)) return begun(a) ? -1 : 1;
    return begun(a) ? dayB.localeCompare(dayA) : dayA.localeCompare(dayB);
  });
}

/** Aktionen that have begun in the last months: the likely choices for new photos. */
export function recentFotoAktionen(items: FotoAktion[], today: string): FotoAktion[] {
  const from = addDays(today, -RECENT_DAYS);
  const soon = addDays(today, SOON_DAYS);
  return items.filter((item) => {
    const start = item.start ?? item.end;
    const end = item.end ?? item.start;
    return start !== null && end !== null && start <= soon && end >= from;
  });
}

/** Aktionen whose title contains every word of the search. */
export function searchFotoAktionen(items: FotoAktion[], query: string): FotoAktion[] {
  const words = query.toLocaleLowerCase('de').split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => {
    const text = `${item.title} ${item.year}`.toLocaleLowerCase('de');
    return words.every((word) => text.includes(word));
  });
}
