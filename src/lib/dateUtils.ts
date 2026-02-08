import type { Aktion } from "./types";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return dateFormatter.format(date);
}

export function formatDateRange(aktion: Aktion): string {
  const start = formatDate(aktion.start);
  const end = formatDate(aktion.end);
  if (!start || !end) {
    return start || end || "";
  }
  if (start === end) {
    return start;
  }
  return `${start} – ${end}`;
}
