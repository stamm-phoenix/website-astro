import type { Aktion } from "./types";

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatDateRange(aktion: Aktion): string {
  const start = formatDate(aktion.start);
  const end = formatDate(aktion.end);
  if (start === end) {
    return start;
  }
  return `${start} – ${end}`;
}
