import { dateToLocalParts } from './nikolaus-config';

/** Client DTOs keep the Berlin clock display for both dated completions and legacy times. */
export function getVisitedTime(visitedAt: string): string {
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(visitedAt)) return visitedAt;
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(visitedAt)) return '';
  const timestamp = new Date(visitedAt);
  return Number.isFinite(timestamp.getTime()) ? dateToLocalParts(timestamp).time : '';
}
