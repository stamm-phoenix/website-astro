import { berlinDay, formatDay } from './format';
import type { Aktion } from './types';

/** The calendar day in Berlin as YYYY-MM-DD, shared with the staff forms. */
export function localDate(date: Date = new Date()): string {
  return berlinDay(date.toISOString())!;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return formatDay(date, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

export function formatDateRange(aktion: Aktion): string {
  const start = formatDate(aktion.start);
  const end = formatDate(aktion.end);
  if (!start || !end) {
    return start || end || '';
  }
  if (start === end) {
    return start;
  }
  return `${start} – ${end}`;
}
