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
  dateToLocalParts,
  formatNikolausDate,
  getNikolausSlots,
  getNikolausTeams,
} from './nikolaus-config';
import { NikolausStateConflictError } from './nikolaus-state';

/**
 * The settings of the Nikolausdienst (module „Steuerung“ in the Leitendenbereich): days and
 * times, switches and the service area. They live in `nikolaus.settings` and `nikolaus.day`
 * and are read on every request, so a change takes effect at once.
 */

/** Taken by every write that changes how many bookings a slot holds. */
export const CAPACITY_LOCK = 'nikolaus:booking-capacity';

/** Saving the whole Einteilung is serialized with this lock. */
export const EINTEILUNG_LOCK = 'nikolaus:einteilung';

/** Saving the Dispo of a day is serialized with this lock. */
export function dispoLock(date: string): string {
  return `nikolaus:dispo:${date}`;
}

/** The kitchen is no team; it exists on every day. */
const KITCHEN = 'Küche';

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
    dayContact:
      row.day_contact_name && row.day_contact_phone
        ? { name: row.day_contact_name, phone: row.day_contact_phone }
        : null,
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

/**
 * Rejects a plan whose teams the Steuerung removed after the request loaded the settings.
 * Called by the Dispo and the Einteilung under their lock, which the Steuerung takes as well.
 */
export async function assertTeamsConfigured(
  db: Db,
  rows: { date: string; team: string }[]
): Promise<void> {
  const days = await loadNikolausDays(db);
  for (const row of rows) {
    if (row.team === KITCHEN) continue;
    if (!getNikolausTeams(row.date, { days }).some((team) => team.name === row.team)) {
      throw new NikolausStateConflictError();
    }
  }
}

/** Only the days, e.g. to check the capacity of a slot inside a transaction. */
export async function loadNikolausDays(db: Db): Promise<NikolausDayConfig[]> {
  const days = await db.selectFrom('nikolaus.day').selectAll().execute();
  return days.map(toDay).sort((a, b) => a.date.localeCompare(b.date));
}

export { validateNikolausSettings } from './nikolaus-settings-schema';

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
  // Fixed order of the values, so the key order of the objects does not matter
  const days = (s: NikolausSettings): unknown[] =>
    s.days.map((day) => [day.date, day.start, day.end, day.teams]);
  const area = ({ area: a }: NikolausSettings): unknown[] => [
    a.base.name,
    a.base.lat,
    a.base.lon,
    a.servicePostalCodes,
    a.farDistanceKm,
  ];
  if (JSON.stringify(days(previous)) !== JSON.stringify(days(next)))
    changes.days = { from: previous.days, to: next.days };
  if (JSON.stringify(area(previous)) !== JSON.stringify(area(next)))
    changes.area = { from: previous.area, to: next.area };
  const contact = (s: NikolausSettings): unknown[] => [s.dayContact?.name, s.dayContact?.phone];
  if (JSON.stringify(contact(previous)) !== JSON.stringify(contact(next)))
    changes.dayContact = { from: previous.dayContact, to: next.dayContact };
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
    // Dispo and Einteilung wait until the new days are saved, and then check their teams
    await lockResource(trx, EINTEILUNG_LOCK);
    const dates = new Set([...current.settings.days, ...next.days].map((day) => day.date));
    for (const date of [...dates].sort()) await lockResource(trx, dispoLock(date));

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
        day_contact_name: next.dayContact?.name ?? null,
        day_contact_phone: next.dayContact?.phone ?? null,
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

    const internal = new Set(['staffActive', 'maintenance', 'dayContact']);
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
