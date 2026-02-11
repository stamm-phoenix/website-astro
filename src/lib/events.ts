export const GROUP_EMOJIS = {
  woelflinge: '🟠',
  jupfis: '🔵',
  pfadis: '🟢',
  rover: '🔴',
} as const;

export type GroupKey = keyof typeof GROUP_EMOJIS;

export const GROUP_LABELS: Record<GroupKey, string> = {
  woelflinge: 'Wölflinge',
  jupfis: 'Jungpfadfinder',
  pfadis: 'Pfadfinder',
  rover: 'Rover',
};

export const GROUP_AGE_RANGES: Record<GroupKey, string> = {
  woelflinge: '7–9 Jahre',
  jupfis: '10–12 Jahre',
  pfadis: '13–15 Jahre',
  rover: '16–18 Jahre',
};

/**
 * Maps API stufe names (German, with umlauts) to lowercase filter keys used in URLs.
 * The filter keys differ from types.ts GroupKey (PascalCase) because they are used
 * in URL query parameters where lowercase is conventional, and "jupfis"/"pfadis"
 * are shorter abbreviations matching the established E2E test expectations.
 */
export const stufeToFilterKey: Record<string, GroupKey> = {
  Wölflinge: 'woelflinge',
  Jungpfadfinder: 'jupfis',
  Pfadfinder: 'pfadis',
  Rover: 'rover',
};

/**
 * Converts an array of API stufe names to their corresponding filter keys.
 */
export function stufeToFilterKeys(stufen: string[]): GroupKey[] {
  return stufen
    .map((s: string) => stufeToFilterKey[s])
    .filter((key: GroupKey | undefined): key is GroupKey => key !== undefined);
}

export type RawEvent = {
  uid: string;
  start: string;
  end?: string;
  allDay?: boolean;
  summary?: string;
  location?: string;
  description?: string;
  url?: string;
};

export type Event = Omit<RawEvent, 'start' | 'end'> & {
  start: Date;
  end?: Date;
};

const dfDate = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const dfTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

const groupEmojiPattern = /[🟠🔵🟢🔴]/gu;

/**
 * Normalize an array of raw event records by removing entries missing required identifiers and converting date fields to Date objects.
 *
 * @param rawEvents - Input array of raw event objects potentially containing string dates and optional fields
 * @returns An array of Event objects where each item has `start` as a Date, `end` as a Date if present, and entries without `uid` or `start` removed
 */
export function normalizeEvents(rawEvents: RawEvent[]): Event[] {
  return rawEvents
    .filter((event) => event?.uid && event?.start)
    .map((event) => ({
      ...event,
      start: new Date(event.start),
      end: event.end ? new Date(event.end) : undefined,
    }));
}

/**
 * Determine whether an event occurs on or after the start of the reference day.
 *
 * Uses `event.end` when present, otherwise uses `event.start` to determine occurrence.
 *
 * @param event - Event to evaluate
 * @param now - Reference date whose local midnight defines "today" (defaults to current date)
 * @returns `true` if the event's end or start is on or after the reference day's midnight, `false` otherwise.
 */
export function isUpcoming(event: Event, now = new Date()): boolean {
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = event.end ?? event.start;
  return end >= todayMidnight;
}

/**
 * Identify group keys whose emojis appear in a text summary.
 *
 * @param summary - Text to scan for group emojis
 * @returns An array of `GroupKey` values whose corresponding emoji is present in `summary`
 */
export function extractGroups(summary = ''): GroupKey[] {
  return (Object.entries(GROUP_EMOJIS) as [GroupKey, string][]).reduce<GroupKey[]>(
    (acc, [key, emoji]) => {
      if (summary.includes(emoji)) acc.push(key);
      return acc;
    },
    []
  );
}

/**
 * Removes group emoji markers from an event summary and trims surrounding whitespace.
 *
 * @param summary - Text potentially containing group emojis; defaults to an empty string.
 * @returns The summary with all group emojis removed and leading/trailing whitespace trimmed.
 */
export function stripGroupEmojis(summary = ''): string {
  return summary.replace(groupEmojiPattern, '').trim();
}

/**
 * Produces a human-readable German date/time string for an event.
 *
 * @param event - The event to format
 * @returns A formatted string:
 *  - `"Termin folgt"` when the event start is invalid;
 *  - for all-day events: a single date with " (ganztägig)" or a date range for multi-day all-day events;
 *  - for timed events with an end on the same day: `"Date, startTime–endTime"`;
 *  - for timed events spanning multiple days: `"startDate, startTime – endDate, endTime"`;
 *  - for timed events without an end: `"Date, startTime"`.
 */
export function formatEventDate(event: Event): string {
  if (!event.start || Number.isNaN(event.start.getTime())) return 'Termin folgt';

  const start = event.start;
  const end = event.end && !Number.isNaN(event.end.getTime()) ? event.end : undefined;

  if (event.allDay) {
    if (end && end.getTime() - start.getTime() > 24 * 3600 * 1000) {
      const inclusiveEnd = new Date(end.getTime() - 1);
      return `${dfDate.format(start)} – ${dfDate.format(inclusiveEnd)} (ganztägig)`;
    }
    return `${dfDate.format(start)} (ganztägig)`;
  }

  if (end) {
    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();

    if (sameDay) {
      return `${dfDate.format(start)}, ${dfTime.format(start)}–${dfTime.format(end)}`;
    }

    return `${dfDate.format(start)}, ${dfTime.format(start)} – ${dfDate.format(end)}, ${dfTime.format(end)}`;
  }

  return `${dfDate.format(start)}, ${dfTime.format(start)}`;
}
