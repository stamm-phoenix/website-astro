import { dateToLocalParts } from './nikolaus-config';
import type { RetentionSources } from './nikolaus-retention';

export interface RetentionSeasonPolicy {
  schema: 1;
  season: number;
  /** Latest visit or planning/availability day, including later actual visit timestamps. */
  lastVisit: string;
  /** Berlin calendar date one calendar month after lastVisit, with month ends clamped. */
  deleteOn: string;
  /** Exclusive cutoff covering every known source date in the selected calendar season. */
  before: string;
}

export interface NikolausRetentionSchedule {
  policies: RetentionSeasonPolicy[];
  /** Seasons with source data still present, excluding schedule tombstones themselves. */
  dataSeasons: number[];
  /** Policies that have reached their Berlin date and still have source data to clean. */
  duePolicies: RetentionSeasonPolicy[];
}

export class InvalidRetentionScheduleError extends Error {
  constructor() {
    super('Invalid Nikolaus retention schedule data. Automatic cleanup must stop.');
    this.name = 'InvalidRetentionScheduleError';
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function realDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvalidRetentionScheduleError();
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new InvalidRetentionScheduleError();
  }
  return value;
}

function sourceDate(value: unknown): string {
  return realDate(typeof value === 'string' ? value.slice(0, 10) : value);
}

function validSeason(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 2000 || value > 2200) {
    throw new InvalidRetentionScheduleError();
  }
  return value;
}

/** Calendar arithmetic is independent of DST and the machine's local time zone. */
export function addRetentionCalendarMonth(value: string): string {
  const date = realDate(value);
  const [year, month, day] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function nextDate(value: string): string {
  const parsed = new Date(`${realDate(value)}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function policy(season: number, lastVisit: string): RetentionSeasonPolicy {
  validSeason(season);
  realDate(lastVisit);
  if (Number(lastVisit.slice(0, 4)) < season) throw new InvalidRetentionScheduleError();
  const followingSeason = `${season + 1}-01-01`;
  const afterVisit = nextDate(lastVisit);
  return {
    schema: 1,
    season,
    lastVisit,
    deleteOn: addRetentionCalendarMonth(lastVisit),
    before: afterVisit < followingSeason ? afterVisit : followingSeason,
  };
}

export function retentionScheduleKey(season: number): string {
  return `retention:schedule:${validSeason(season)}`;
}

function parsePolicy(value: unknown, season: number): RetentionSeasonPolicy {
  if (!object(value) || value.schema !== 1 || value.season !== season) {
    throw new InvalidRetentionScheduleError();
  }
  const parsed = policy(season, realDate(value.lastVisit));
  if (value.deleteOn !== parsed.deleteOn || value.before !== parsed.before) {
    throw new InvalidRetentionScheduleError();
  }
  return parsed;
}

/** The CAS callback can only extend a persisted deadline, never move it earlier. */
export function mergeRetentionSeasonPolicy(
  current: unknown | undefined,
  desired: RetentionSeasonPolicy
): RetentionSeasonPolicy {
  const next = parsePolicy(desired, desired.season);
  if (current === undefined) return next;
  const previous = parsePolicy(current, desired.season);
  return previous.lastVisit > next.lastVisit ? previous : next;
}

function fields(raw: unknown): Record<string, unknown> {
  if (!object(raw) || !object(raw.fields)) throw new InvalidRetentionScheduleError();
  return raw.fields;
}

function planningRows(value: unknown): Record<string, unknown>[] {
  if (
    !object(value) ||
    value.schema !== 1 ||
    !Array.isArray(value.rows) ||
    !value.rows.every(object)
  ) {
    throw new InvalidRetentionScheduleError();
  }
  return value.rows as Record<string, unknown>[];
}

function clock(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined;
  return value;
}

function visitDate(value: unknown, plannedDate: string, plannedStart: string | undefined): string {
  if (value === undefined || value === null || value === '') return plannedDate;
  const visitedClock = clock(value);
  if (visitedClock) {
    // Nikolaus rounds are in the evening. An early morning completion belongs to the
    // following day; an earlier evening arrival does not mean a next-day visit.
    return plannedStart && visitedClock < plannedStart && visitedClock < '06:00'
      ? nextDate(plannedDate)
      : plannedDate;
  }
  if (typeof value !== 'string') throw new InvalidRetentionScheduleError();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return realDate(value);
  // An offset is required so host-local parsing cannot move a visit to another date.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new InvalidRetentionScheduleError();
  }
  sourceDate(value);
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new InvalidRetentionScheduleError();
  return dateToLocalParts(timestamp).date;
}

/** Pure source inspection. Persist the returned policies by CAS before applying cleanup. */
export function getNikolausRetentionSchedule(
  sources: RetentionSources,
  now: Date = new Date()
): NikolausRetentionSchedule {
  if (!Number.isFinite(now.getTime())) throw new InvalidRetentionScheduleError();
  const lastDates = new Map<number, string>();
  const dataSeasons = new Set<number>();
  const bookingDays = new Map<string, { date: string; season: number; start?: string }>();
  const observe = (date: string, season = Number(date.slice(0, 4))): void => {
    validSeason(season);
    realDate(date);
    dataSeasons.add(season);
    if (!lastDates.has(season) || date > lastDates.get(season)!) lastDates.set(season, date);
  };
  for (const raw of sources.booking) {
    const row = fields(raw);
    const date = sourceDate(row.SlotKey);
    if (!object(raw) || typeof raw.id !== 'string' || !raw.id) {
      throw new InvalidRetentionScheduleError();
    }
    const season = Number(date.slice(0, 4));
    const start = typeof row.SlotKey === 'string' ? clock(row.SlotKey.slice(11, 16)) : undefined;
    bookingDays.set(raw.id, { date, season, start });
    observe(date, season);
  }
  for (const raw of sources.dispo) {
    const row = fields(raw);
    const date = sourceDate(row.Datum);
    const booking = typeof row.Title === 'string' ? bookingDays.get(row.Title) : undefined;
    const season = booking?.season ?? Number(date.slice(0, 4));
    observe(date, season);
    observe(visitDate(row.BesuchtUm, date, clock(row.GeplanteAnkunft) ?? booking?.start), season);
  }
  for (const raw of sources.helper) {
    const row = fields(raw);
    let availability: unknown;
    try {
      availability = JSON.parse(typeof row.Verfuegbarkeit === 'string' ? row.Verfuegbarkeit : '{}');
    } catch {
      throw new InvalidRetentionScheduleError();
    }
    if (!object(availability)) throw new InvalidRetentionScheduleError();
    for (const date of Object.keys(availability)) observe(realDate(date));
  }
  for (const raw of sources.einteilung) observe(sourceDate(fields(raw).Datum));
  for (const state of sources.states) {
    if (state.key.startsWith('retention:schedule:')) {
      const suffix = state.key.slice('retention:schedule:'.length);
      if (!/^\d{4}$/.test(suffix)) throw new InvalidRetentionScheduleError();
      const season = validSeason(Number(suffix));
      const saved = parsePolicy(state.data, season);
      if (!lastDates.has(season) || saved.lastVisit > lastDates.get(season)!) {
        lastDates.set(season, saved.lastVisit);
      }
    } else if (state.key.startsWith('planning:dispo:')) {
      const date = realDate(state.key.slice('planning:dispo:'.length));
      observe(date);
      for (const row of planningRows(state.data)) {
        if (sourceDate(row.date) !== date || typeof row.bookingId !== 'string' || !row.bookingId) {
          throw new InvalidRetentionScheduleError();
        }
        const booking = bookingDays.get(row.bookingId);
        const season = booking?.season ?? Number(date.slice(0, 4));
        observe(date, season);
        observe(
          visitDate(row.visitedAt, date, clock(row.plannedArrival) ?? booking?.start),
          season
        );
      }
    } else if (state.key === 'planning:einteilung') {
      for (const row of planningRows(state.data)) observe(sourceDate(row.date));
    }
    // Mail quotas and geocoding data are unrelated to the season schedule.
  }
  const policies = [...lastDates.entries()]
    .sort(([left], [right]) => left - right)
    .map(([season, lastVisit]) => policy(season, lastVisit));
  const today = dateToLocalParts(now).date;
  return {
    policies,
    dataSeasons: [...dataSeasons].sort((left, right) => left - right),
    duePolicies: policies.filter((item) => item.deleteOn <= today && dataSeasons.has(item.season)),
  };
}
