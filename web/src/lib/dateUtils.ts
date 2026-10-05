import type { Aktion } from './types';

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

/** The local calendar day as `YYYY-MM-DD` (unlike `toISOString()`, which gives the UTC day). */
export function localDate(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return dateFormatter.format(date);
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
