import type { AnwesenheitMeeting } from './types';

/** Weekday of a Gruppenstunde as written in the list („Freitags“), Monday = 1 … Sunday = 7. */
const WEEKDAY_NUMBERS: Record<string, number> = {
  montags: 1,
  dienstags: 2,
  mittwochs: 3,
  donnerstags: 4,
  freitags: 5,
  samstags: 6,
  sonntags: 7,
};

/**
 * The most recent date (`YYYY-MM-DD`) on the weekday of the Gruppenstunde, today included;
 * `today` if the weekday is unknown.
 */
export function suggestedDate(weekday: string, today: string): string {
  const target = WEEKDAY_NUMBERS[weekday.trim().toLowerCase()];
  if (target === undefined) return today;
  const date = new Date(`${today}T00:00:00Z`);
  const current = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - ((current - target + 7) % 7));
  return date.toISOString().slice(0, 10);
}

export interface MonthStats {
  /** `YYYY-MM` */
  month: string;
  termine: number;
  members: number;
  guests: number;
}

/** Termine of one Stufe summed up per month, newest month first. */
export function monthlyStats(meetings: AnwesenheitMeeting[], stufe: string): MonthStats[] {
  const months = new Map<string, MonthStats>();
  for (const meeting of meetings) {
    if (meeting.stufe !== stufe) continue;
    const month = meeting.date.slice(0, 7);
    const entry = months.get(month) ?? { month, termine: 0, members: 0, guests: 0 };
    entry.termine += 1;
    entry.members += meeting.members;
    entry.guests += meeting.guests;
    months.set(month, entry);
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}
