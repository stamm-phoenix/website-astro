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

const groupEmojiPattern = /[🟠🔵🟢🔴]/g;

export function normalizeEvents(rawEvents: RawEvent[]): Event[] {
  return rawEvents
    .filter((event) => event?.uid && event?.start)
    .map((event) => ({
      ...event,
      start: new Date(event.start),
      end: event.end ? new Date(event.end) : undefined,
    }));
}

export function isUpcoming(event: Event, now = new Date()): boolean {
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = event.end ?? event.start;
  return end >= todayMidnight;
}

export function extractGroups(summary = ''): GroupKey[] {
  return (Object.entries(GROUP_EMOJIS) as [GroupKey, string][]).reduce<GroupKey[]>((acc, [key, emoji]) => {
    if (summary.includes(emoji)) acc.push(key);
    return acc;
  }, []);
}

export function stripGroupEmojis(summary = ''): string {
  return summary.replace(groupEmojiPattern, '').trim();
}

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
