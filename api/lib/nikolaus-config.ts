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
}

export const NIKOLAUS_CONFIG: NikolausConfig = {
  active: true,
  defaultStart: '17:00',
  defaultEnd: '21:00',
  pendingHoldMinutes: 120,
  changeDeadlineHours: 24,
  days: [
    { date: '2026-12-05', teams: 2 },
    { date: '2026-12-06', teams: 3 },
  ],
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
