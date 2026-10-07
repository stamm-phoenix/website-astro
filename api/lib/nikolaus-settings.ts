import type { Selectable } from 'kysely';
import type { DayTable, SettingsTable } from './db-schema';
import type { Db } from './db';
import {
  VersionConflictError,
  getDb,
  inTransaction,
  lockResource,
  parseStringList,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type { NikolausDayConfig, NikolausSettings } from './nikolaus-config';
import {
  NIKOLAUS_SLOT_MINUTES,
  NIKOLAUS_TEAMS,
  dateToLocalParts,
  formatNikolausDate,
  getNikolausSlots,
  getNikolausTeams,
} from './nikolaus-config';
import type { FieldErrors } from './pflege-validation';
import { ValidationError } from './pflege-validation';

/**
 * The settings of the Nikolausdienst (module „Steuerung“ in the Leitendenbereich): days and
 * times, switches and the service area. They live in `nikolaus.settings` and `nikolaus.day`
 * and are read on every request, so a change takes effect at once.
 */

/** Taken by every write that changes how many bookings a slot holds. */
export const CAPACITY_LOCK = 'nikolaus:booking-capacity';

/**
 * Pending bookings keep blocking their slot for this long after `reserved_until`, so a
 * confirmation arriving right at the expiry can never race with a new booking.
 */
export const EXPIRY_GRACE_MS = 5 * 60_000;

export interface StoredNikolausSettings {
  settings: NikolausSettings;
  etag: string;
  updatedAt: string;
  updatedBy: string;
}

function toDay(row: Selectable<DayTable>): NikolausDayConfig {
  return {
    date: toDateString(row.date),
    start: row.start_time,
    end: row.end_time,
    teams: row.teams,
  };
}

function toSettings(
  row: Selectable<SettingsTable>,
  days: Selectable<DayTable>[]
): NikolausSettings {
  return {
    publicActive: row.public_active,
    staffActive: row.staff_active,
    maintenance: row.maintenance,
    pendingHoldMinutes: row.pending_hold_minutes,
    changeDeadlineHours: row.change_deadline_hours,
    days: days.map(toDay).sort((a, b) => a.date.localeCompare(b.date)),
    area: {
      base: {
        name: row.base_name,
        lat: Number(row.base_latitude),
        lon: Number(row.base_longitude),
      },
      servicePostalCodes: parseStringList(row.service_postal_codes),
      farDistanceKm: Number(row.far_distance_km),
    },
  };
}

/** The settings together with their version and the last change. */
export async function loadNikolausSettings(db: Db = getDb()): Promise<StoredNikolausSettings> {
  const [row, days] = await Promise.all([
    db.selectFrom('nikolaus.settings').selectAll().where('id', '=', 1).executeTakeFirstOrThrow(),
    db.selectFrom('nikolaus.day').selectAll().execute(),
  ]);
  return {
    settings: toSettings(row, days),
    etag: toVersion(row.version),
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
  };
}

export async function getNikolausSettings(db: Db = getDb()): Promise<NikolausSettings> {
  return (await loadNikolausSettings(db)).settings;
}

/** Only the days, e.g. to check the capacity of a slot inside a transaction. */
export async function loadNikolausDays(db: Db): Promise<NikolausDayConfig[]> {
  const days = await db.selectFrom('nikolaus.day').selectAll().execute();
  return days.map(toDay).sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DAYS = 10;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function minutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Checks the form of the Steuerung; errors are reported per field (`days.0.start` …). */
export function validateNikolausSettings(body: unknown): NikolausSettings {
  const input = record(body);
  const errors: FieldErrors = {};

  const flag = (field: string): boolean => {
    if (typeof input[field] !== 'boolean') errors[field] = 'Bitte auswählen.';
    return input[field] === true;
  };
  const integer = (value: unknown, field: string, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      errors[field] = `Bitte eine ganze Zahl von ${min} bis ${max} angeben.`;
      return min;
    }
    return value;
  };
  const decimal = (value: unknown, field: string, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      errors[field] = `Bitte eine Zahl von ${min} bis ${max} angeben.`;
      return min;
    }
    return value;
  };

  const rawDays = Array.isArray(input.days) ? input.days : [];
  if (!Array.isArray(input.days)) errors.days = 'Bitte die Besuchstage angeben.';
  if (rawDays.length > MAX_DAYS) errors.days = `Höchstens ${MAX_DAYS} Besuchstage.`;
  const days: NikolausDayConfig[] = rawDays.slice(0, MAX_DAYS).map((raw, index) => {
    const day = record(raw);
    const date = typeof day.date === 'string' ? day.date : '';
    const start = typeof day.start === 'string' ? day.start : '';
    const end = typeof day.end === 'string' ? day.end : '';
    if (!isRealDate(date)) errors[`days.${index}.date`] = 'Bitte ein gültiges Datum angeben.';
    if (!TIME.test(start)) errors[`days.${index}.start`] = 'Bitte eine Uhrzeit (HH:MM) angeben.';
    if (!TIME.test(end)) errors[`days.${index}.end`] = 'Bitte eine Uhrzeit (HH:MM) angeben.';
    else if (TIME.test(start) && minutes(end) - minutes(start) < NIKOLAUS_SLOT_MINUTES) {
      errors[`days.${index}.end`] =
        `Das Ende muss mindestens ${NIKOLAUS_SLOT_MINUTES} Minuten nach dem Beginn liegen.`;
    } else if (TIME.test(start) && (minutes(end) - minutes(start)) % NIKOLAUS_SLOT_MINUTES) {
      errors[`days.${index}.end`] =
        `Die Zeit muss in Termine zu ${NIKOLAUS_SLOT_MINUTES} Minuten aufgehen.`;
    }
    const teams = integer(day.teams, `days.${index}.teams`, 1, NIKOLAUS_TEAMS.length);
    return { date, start, end, teams };
  });
  days.forEach((day, index) => {
    if (days.findIndex((other) => other.date === day.date) !== index) {
      errors[`days.${index}.date`] = 'Dieser Tag ist schon eingetragen.';
    }
  });

  const area = record(input.area);
  const base = record(area.base);
  const baseName = typeof base.name === 'string' ? base.name.trim() : '';
  if (!baseName || baseName.length > 100) errors['area.base.name'] = 'Bitte einen Namen angeben.';
  const rawCodes = Array.isArray(area.servicePostalCodes) ? area.servicePostalCodes : null;
  const codes = (rawCodes ?? []).map((code) => (typeof code === 'string' ? code.trim() : ''));
  if (!rawCodes || codes.length === 0 || codes.length > 30 || codes.some((c) => !/^\d{5}$/.test(c)))
    errors['area.servicePostalCodes'] = 'Bitte fünfstellige Postleitzahlen angeben.';

  const settings: NikolausSettings = {
    publicActive: flag('publicActive'),
    staffActive: flag('staffActive'),
    maintenance: flag('maintenance'),
    pendingHoldMinutes: integer(input.pendingHoldMinutes, 'pendingHoldMinutes', 5, 1440),
    changeDeadlineHours: integer(input.changeDeadlineHours, 'changeDeadlineHours', 0, 336),
    days: days.sort((a, b) => a.date.localeCompare(b.date)),
    area: {
      base: {
        name: baseName,
        lat: decimal(base.lat, 'area.base.lat', -90, 90),
        lon: decimal(base.lon, 'area.base.lon', -180, 180),
      },
      servicePostalCodes: [...new Set(codes)],
      farDistanceKm: decimal(area.farDistanceKm, 'area.farDistanceKm', 0.1, 1000),
    },
  };
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return settings;
}

// ---------------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------------

/** Plans and bookings that would no longer fit the new days, times or teams. */
async function findConflicts(db: Db, next: NikolausSettings, now: Date): Promise<string[]> {
  const today = dateToLocalParts(now).date;
  const slots = new Map(getNikolausSlots(next).map((slot) => [slot.key, slot]));
  const teamsOf = (date: string): Set<string> =>
    new Set(getNikolausTeams(date, next).map((team) => team.name));
  const conflicts: string[] = [];

  // Past seasons are kept until they are deleted; only what is still ahead must fit
  const booked = await db
    .selectFrom('nikolaus.booking')
    .select((eb) => ['slot_key', eb.fn.countAll<number>().as('count')])
    .where('visit_date', '>=', today)
    .where((eb) =>
      eb.or([
        eb('status', '=', 'Bestaetigt'),
        eb.and([
          eb('status', '=', 'Ausstehend'),
          eb('reserved_until', '>', new Date(now.getTime() - EXPIRY_GRACE_MS)),
        ]),
      ])
    )
    .groupBy('slot_key')
    .execute();
  for (const { slot_key: key, count } of booked) {
    const slot = slots.get(key);
    const [date, time] = key.split('T');
    const label = `${formatNikolausDate(date)}, ${time} Uhr`;
    if (!slot) conflicts.push(`${label}: ${count} Anmeldung(en), den Termin gäbe es nicht mehr.`);
    else if (Number(count) > slot.capacity)
      conflicts.push(`${label}: ${count} Anmeldungen, aber nur ${slot.capacity} Team(s).`);
  }

  const planned = [
    ...(await db
      .selectFrom('nikolaus.dispo_visit')
      .select(['date', 'team'])
      .distinct()
      .where('date', '>=', today)
      .execute()),
    ...(await db
      .selectFrom('nikolaus.assignment')
      .select(['date', 'team'])
      .distinct()
      .where('date', '>=', today)
      .where('team', '<>', 'Küche')
      .execute()),
  ];
  const missing = new Set<string>();
  for (const row of planned) {
    const date = toDateString(row.date);
    if (!teamsOf(date).has(row.team)) missing.add(`${date}|${row.team}`);
  }
  for (const entry of [...missing].sort()) {
    const [date, team] = entry.split('|');
    conflicts.push(
      `${formatNikolausDate(date)}: Dispo oder Einteilung nutzen Team ${team}, das es nicht mehr gäbe.`
    );
  }
  return conflicts;
}

/** The fields that differ, for the log. */
function describeChanges(
  previous: NikolausSettings,
  next: NikolausSettings
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const compare = (field: string, from: unknown, to: unknown): void => {
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  };
  compare('publicActive', previous.publicActive, next.publicActive);
  compare('staffActive', previous.staffActive, next.staffActive);
  compare('maintenance', previous.maintenance, next.maintenance);
  compare('pendingHoldMinutes', previous.pendingHoldMinutes, next.pendingHoldMinutes);
  compare('changeDeadlineHours', previous.changeDeadlineHours, next.changeDeadlineHours);
  compare('days', previous.days, next.days);
  compare('area', previous.area, next.area);
  return changes;
}

export interface SaveSettingsResult {
  stored: StoredNikolausSettings;
  /** Whether anything shown on the public pages changed. */
  publicChanged: boolean;
}

/**
 * Saves the settings if they still have the loaded version. Bookings, Dispo and Einteilung
 * from today on must fit the new days and teams; the capacity lock keeps bookings from
 * slipping in while this is checked.
 */
export async function saveNikolausSettings(
  next: NikolausSettings,
  etag: string,
  actor: string,
  now: Date = new Date()
): Promise<SaveSettingsResult> {
  const version = requireVersion(etag);
  return inTransaction(async (trx) => {
    await lockResource(trx, CAPACITY_LOCK);
    const current = await loadNikolausSettings(trx);
    if (current.etag !== etag) throw new VersionConflictError();

    const conflicts = await findConflicts(trx, next, now);
    if (conflicts.length) throw new SettingsConflictError(conflicts);

    const changes = describeChanges(current.settings, next);
    if (Object.keys(changes).length === 0) return { stored: current, publicChanged: false };

    const result = await trx
      .updateTable('nikolaus.settings')
      .set({
        public_active: next.publicActive,
        staff_active: next.staffActive,
        maintenance: next.maintenance,
        pending_hold_minutes: next.pendingHoldMinutes,
        change_deadline_hours: next.changeDeadlineHours,
        base_name: next.area.base.name,
        base_latitude: next.area.base.lat,
        base_longitude: next.area.base.lon,
        service_postal_codes: JSON.stringify(next.area.servicePostalCodes),
        far_distance_km: next.area.farDistanceKm,
        updated_at: now,
        updated_by: actor,
      })
      .where('id', '=', 1)
      .where('version', '=', version)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();

    if ('days' in changes) {
      await trx.deleteFrom('nikolaus.day').execute();
      if (next.days.length) {
        await trx
          .insertInto('nikolaus.day')
          .values(
            next.days.map((day) => ({
              date: day.date,
              start_time: day.start,
              end_time: day.end,
              teams: day.teams,
            }))
          )
          .execute();
      }
    }
    await writeAuditLog(trx, actor, 'settings', { changes });

    const internal = new Set(['staffActive', 'maintenance']);
    return {
      stored: await loadNikolausSettings(trx),
      publicChanged: Object.keys(changes).some((field) => !internal.has(field)),
    };
  });
}

/** The new settings do not fit bookings or plans that already exist. */
export class SettingsConflictError extends Error {
  constructor(public conflicts: string[]) {
    super('Die Einstellungen passen nicht zu vorhandenen Anmeldungen oder Planungen.');
    this.name = 'SettingsConflictError';
  }
}

// ---------------------------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------------------------

export interface AuditLogEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  details: Record<string, unknown>;
}

export async function writeAuditLog(
  db: Db,
  actor: string,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  await db
    .insertInto('nikolaus.audit_log')
    .values({ actor, action, details: JSON.stringify(details) })
    .execute();
}

/** The latest entries, newest first. */
export async function listAuditLog(limit = 50, db: Db = getDb()): Promise<AuditLogEntry[]> {
  const rows = await db
    .selectFrom('nikolaus.audit_log')
    .selectAll()
    .orderBy('id', 'desc')
    .top(limit)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    actor: row.actor,
    action: row.action,
    details: JSON.parse(row.details) as Record<string, unknown>,
  }));
}
