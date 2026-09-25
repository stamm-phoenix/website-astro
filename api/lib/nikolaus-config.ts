/**
 * Configuration for the Nikolausdienst booking (/nikolaus).
 *
 * This file is shared between the API and the web frontend (imported via
 * `web/src/lib/nikolausConfig.ts`), so it must stay free of imports and
 * Node/browser specific APIs. Changes take effect with the next deployment.
 */

export interface NikolausDayConfig {
  /** Date in ISO format (YYYY-MM-DD). */
  date: string;
  /** Number of teams available on this day = bookings per slot. */
  teams: number;
  /** Optional override of the first slot start time (HH:MM). */
  start?: string;
  /** Optional override of the end time of the last slot (HH:MM). */
  end?: string;
}

export interface NikolausConfig {
  /** Master switch: shows the page content, navigation entry and homepage banner. */
  active: boolean;
  /** Default start of the first slot (HH:MM, local time). */
  defaultStart: string;
  /** Default end of the last slot (HH:MM, local time). */
  defaultEnd: string;
  /** How long an unconfirmed booking blocks its slot. */
  pendingHoldMinutes: number;
  /** Until how many hours before the appointment families may change or cancel it themselves. */
  changeDeadlineHours: number;
  days: NikolausDayConfig[];
  area: NikolausAreaConfig;
}

export interface NikolausCoordinates {
  lat: number;
  lon: number;
}

export interface NikolausAreaConfig {
  /** Starting point of the teams; used for the map and the distance hint. */
  base: NikolausCoordinates & { name: string };
  /** Postal codes of the service area; other codes only trigger a hint. */
  servicePostalCodes: string[];
  /** From this air-line distance on, families are told that the visit may be later and shorter. */
  farDistanceKm: number;
}

export const NIKOLAUS_CONFIG: NikolausConfig = {
  active: true,
  defaultStart: '17:00',
  defaultEnd: '21:00',
  pendingHoldMinutes: 120,
  changeDeadlineHours: 24,
  days: [
    { date: '2026-12-04', teams: 2 },
    { date: '2026-12-05', teams: 2 },
    { date: '2026-12-06', teams: 2 },
  ],
  area: {
    // Pfarrheim, Münchener Straße 1, 83620 Feldkirchen-Westerham
    base: { name: 'Pfarrheim', lat: 47.90885, lon: 11.84664 },
    servicePostalCodes: ['83620', '83052'],
    farDistanceKm: 8,
  },
};

/** Every appointment is exactly 30 minutes long. */
export const NIKOLAUS_SLOT_MINUTES = 30;

export const NIKOLAUS_TIME_ZONE = 'Europe/Berlin';

export interface NikolausSlotDefinition {
  /** Unique key in local time, e.g. `2026-12-05T17:00`. */
  key: string;
  date: string;
  /** Start time (HH:MM). */
  time: string;
  /** End time (HH:MM). */
  endTime: string;
  capacity: number;
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function fromMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Returns all bookable slots derived from the configuration, in chronological order. */
export function getNikolausSlots(
  config: NikolausConfig = NIKOLAUS_CONFIG
): NikolausSlotDefinition[] {
  const slots: NikolausSlotDefinition[] = [];
  const days = [...config.days].sort((a, b) => a.date.localeCompare(b.date));

  for (const day of days) {
    const start = toMinutes(day.start ?? config.defaultStart);
    const end = toMinutes(day.end ?? config.defaultEnd);

    for (let t = start; t + NIKOLAUS_SLOT_MINUTES <= end; t += NIKOLAUS_SLOT_MINUTES) {
      const time = fromMinutes(t);
      slots.push({
        key: `${day.date}T${time}`,
        date: day.date,
        time,
        endTime: fromMinutes(t + NIKOLAUS_SLOT_MINUTES),
        capacity: day.teams,
      });
    }
  }

  return slots;
}

/** Finds a slot definition by its key, or `undefined` if the slot is not configured. */
export function findNikolausSlot(key: string): NikolausSlotDefinition | undefined {
  return getNikolausSlots().find((slot) => slot.key === key);
}

/**
 * Converts a local slot key (`YYYY-MM-DDTHH:MM` in Europe/Berlin) to a UTC Date.
 */
export function slotKeyToDate(key: string): Date {
  const [datePart, timePart] = key.split('T');
  return localDateTimeToDate(datePart, timePart);
}

/** Converts a local date (`YYYY-MM-DD`) and time (`HH:MM`) in Europe/Berlin to a Date. */
export function localDateTimeToDate(datePart: string, timePart: string): Date {
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);

  // First guess: treat the local time as UTC, then correct by the zone offset at that instant.
  const guess = Date.UTC(year, month - 1, day, hours, minutes);
  const offset = getTimeZoneOffsetMinutes(new Date(guess));
  const corrected = guess - offset * 60_000;
  // Re-evaluate the offset in case the guess crossed a DST boundary.
  const finalOffset = getTimeZoneOffsetMinutes(new Date(corrected));
  return new Date(guess - finalOffset * 60_000);
}

/** Splits a point in time into local date (`YYYY-MM-DD`) and time (`HH:MM`) in Europe/Berlin. */
export function dateToLocalParts(instant: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NIKOLAUS_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

function getTimeZoneOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NIKOLAUS_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** Latest point in time at which a booking for this slot may be changed or cancelled online. */
export function getChangeDeadline(slotKey: string, config: NikolausConfig = NIKOLAUS_CONFIG): Date {
  return new Date(slotKeyToDate(slotKey).getTime() - config.changeDeadlineHours * 60 * 60_000);
}

/** Formats a date like `Samstag, 5. Dezember 2026`. */
export function formatNikolausDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * Lists the configured days in natural German, e.g. `4., 5. und 6. Dezember` or
 * `30. November und 1. Dezember`. Works for any number of days.
 */
export function formatNikolausDays(
  config: NikolausConfig = NIKOLAUS_CONFIG,
  {
    conjunction = 'und',
    withYear = false,
  }: { conjunction?: 'und' | 'oder'; withYear?: boolean } = {}
): string {
  const dates = [...config.days]
    .map((day) => new Date(`${day.date}T00:00:00Z`))
    .sort((a, b) => a.getTime() - b.getTime());
  if (dates.length === 0) return '';

  const month = (d: Date): string =>
    new Intl.DateTimeFormat('de-DE', { month: 'long', timeZone: 'UTC' }).format(d);
  const sameMonth = dates.every(
    (d) =>
      d.getUTCMonth() === dates[0].getUTCMonth() && d.getUTCFullYear() === dates[0].getUTCFullYear()
  );
  const last = dates.length - 1;
  const parts = dates.map((d, i) =>
    sameMonth && i < last ? `${d.getUTCDate()}.` : `${d.getUTCDate()}. ${month(d)}`
  );
  const list = new Intl.ListFormat('de', {
    type: conjunction === 'und' ? 'conjunction' : 'disjunction',
  }).format(parts);
  return withYear ? `${list} ${dates[last].getUTCFullYear()}` : list;
}

/** Air-line distance between two points in kilometres (haversine formula). */
export function distanceKm(a: NikolausCoordinates, b: NikolausCoordinates): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Whether a postal code is not one of the configured service area codes. */
export function isOutsideServicePostalCodes(
  postalCode: string,
  config: NikolausConfig = NIKOLAUS_CONFIG
): boolean {
  return !config.area.servicePostalCodes.includes(postalCode.trim());
}
