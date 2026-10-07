import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Database } from './db-schema';
import { getAllBookings } from './nikolaus-bookings';
import { toLocation } from './nikolaus-api';
import { NIKOLAUS_SLOT_MINUTES, getNikolausTeams } from './nikolaus-config';
import { confirmedOfDay, getTeamMembers } from './nikolaus-day';
import {
  evaluateDispo,
  minutesToTime,
  solveDispo,
  timeToMinutes,
  visitMinutes,
} from './nikolaus-dispo';
import type { DispoProblem } from './nikolaus-dispo';
import { getDispoRows, getDispoVersion, saveDispo } from './nikolaus-dispo-list';
import { conflictingTags, solveEinteilung } from './nikolaus-einteilung';
import {
  getEinteilungRows,
  getEinteilungVersion,
  saveEinteilung,
} from './nikolaus-einteilung-list';
import { getHelpers } from './nikolaus-helfende-list';
import { getNikolausSettings } from './nikolaus-settings';
import { getTravelMatrix } from './travel-times';

/**
 * A database of its own for each PR preview (`website-pr-<number>`), so previews never touch
 * the production data. Created and seeded by the deploy workflow, dropped when the PR closes
 * (`scripts/db-preview.ts`, `docs/azure-sql.md`).
 */

const PR_NUMBER = /^[1-9]\d{0,5}$/;
const READY_TIMEOUT_MS = 5 * 60_000;

/** The database of a PR preview; throws for anything that is not a PR number. */
export function previewDatabaseName(pr: string | number): string {
  const value = String(pr);
  if (!PR_NUMBER.test(value)) throw new Error(`Invalid pull request number: ${value}`);
  return `website-pr-${value}`;
}

function assertPreviewName(name: string): void {
  if (!/^website-pr-[1-9]\d{0,5}$/.test(name)) throw new Error(`Not a preview database: ${name}`);
}

export async function databaseExists(master: Kysely<Database>, name: string): Promise<boolean> {
  const result = await sql<{ found: number }>`
    SELECT COUNT(*) AS found FROM sys.databases WHERE name = ${name}
  `.execute(master);
  return Number(result.rows[0]?.found ?? 0) > 0;
}

export interface CreatePreviewOptions {
  /** Azure SQL: the smallest tier with local backups. False for the SQL Server of the tests. */
  azure: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Creates the database if it does not exist yet and waits until it is online. Returns whether
 * it was created now. Runs in `master`; the creator becomes the owner of the new database.
 */
export async function createPreviewDatabase(
  master: Kysely<Database>,
  name: string,
  { azure, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: CreatePreviewOptions
): Promise<boolean> {
  assertPreviewName(name);
  const created = !(await databaseExists(master, name));
  if (created) {
    // The name is checked above; identifiers cannot be parameters
    const options = azure
      ? ` (EDITION = 'Basic', SERVICE_OBJECTIVE = 'Basic', MAXSIZE = 2 GB) WITH BACKUP_STORAGE_REDUNDANCY = 'LOCAL'`
      : '';
    await sql.raw(`CREATE DATABASE [${name}]${options}`).execute(master);
  }
  // Also an existing one may still be coming up, e.g. after an earlier run was cancelled
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const state = await sql<{ state: string }>`
      SELECT state_desc AS state FROM sys.databases WHERE name = ${name}
    `.execute(master);
    if (state.rows[0]?.state === 'ONLINE') return created;
    if (Date.now() > deadline) throw new Error(`Database ${name} did not come online`);
    await sleep(5_000);
  }
}

/** Drops the database of a preview; a missing one is fine (e.g. a PR closed twice). */
export async function dropPreviewDatabase(
  master: Kysely<Database>,
  name: string
): Promise<boolean> {
  assertPreviewName(name);
  if (!(await databaseExists(master, name))) return false;
  await sql.raw(`DROP DATABASE [${name}]`).execute(master);
  return true;
}

/**
 * Lets the website (its app registration) read and write the preview database. The user is
 * created from the client ID, without a lookup in Entra ID.
 */
export async function grantWebsiteAccess(db: Kysely<Database>, clientId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new Error('Invalid client ID');
  }
  await sql`
    IF DATABASE_PRINCIPAL_ID('website') IS NULL
    BEGIN
      DECLARE @sid varbinary(16) = CAST(CAST(${clientId} AS uniqueidentifier) AS varbinary(16));
      -- EXEC (…) takes only strings and variables, no function calls
      DECLARE @create nvarchar(200) =
        N'CREATE USER [website] WITH SID = ' + CONVERT(nvarchar(64), @sid, 1) + N', TYPE = E';
      EXEC (@create);
    END;
    ALTER ROLE db_datareader ADD MEMBER [website];
    ALTER ROLE db_datawriter ADD MEMBER [website];
  `.execute(db);
}

/**
 * Set once a preview is completely seeded; a run that failed halfway seeds again. The number
 * grows with the test data, so existing previews get what was added (every step only fills
 * what is missing).
 */
const SEEDED_KEY = 'preview:seeded:2';

export async function isPreviewSeeded(db: Kysely<Database>): Promise<boolean> {
  const row = await db
    .selectFrom('nikolaus.state')
    .select('state_key')
    .where('state_key', '=', SEEDED_KEY)
    .executeTakeFirst();
  return row !== undefined;
}

export async function markPreviewSeeded(db: Kysely<Database>): Promise<void> {
  await db
    .insertInto('nikolaus.state')
    .values({ state_key: SEEDED_KEY, value: JSON.stringify({ at: new Date().toISOString() }) })
    .execute();
}

/** Test settings of a new preview: online booking and staff modules switched on. */
export async function enablePreviewSettings(db: Kysely<Database>): Promise<void> {
  await db
    .updateTable('nikolaus.settings')
    .set({ public_active: true, staff_active: true, maintenance: false, updated_by: 'preview' })
    .where('id', '=', 1)
    .execute();
}

/**
 * Saves an Einteilung and a Dispo per day, as the Leitendenbereich would suggest them, so the
 * Fahrt view and the plans have something to show. Plans that exist are kept. Uses the shared
 * connection (`useDatabase`); driving times are estimated unless a routing key is set.
 */
export async function seedPreviewPlans(): Promise<void> {
  const settings = await getNikolausSettings();
  const dates = settings.days.map((day) => day.date).sort();
  const teams = (date: string): string[] =>
    getNikolausTeams(date, settings).map((team) => team.name);

  if ((await getEinteilungRows()).length === 0) {
    const helpers = await getHelpers();
    const { assignments } = solveEinteilung({
      persons: helpers.map((helper) => ({
        id: helper.id,
        name: helper.name,
        availability: helper.availability,
        positiveTags: helper.positiveTags,
        negativeTags: helper.negativeTags,
      })),
      days: dates.map((date) => ({ date, teams: teams(date), familyTags: null })),
    });
    if (assignments.length > 0) await saveEinteilung(assignments, getEinteilungVersion([]));
  }

  const bookings = await getAllBookings();
  for (const date of dates) {
    const stops = confirmedOfDay(bookings, date);
    if (stops.length === 0 || (await getDispoRows(date)).length > 0) continue;
    // As in the Dispo: no family goes to a team with a helper who has a matching negative tag
    const members = await getTeamMembers(date);
    const forbidden: Record<string, string[]> = {};
    for (const booking of stops) {
      const blocked = teams(date).filter((team) =>
        (members[team] ?? []).some(
          (member) => conflictingTags(member, [booking.internalTags]).length > 0
        )
      );
      if (blocked.length > 0) forbidden[booking.id] = blocked;
    }
    const travel = await getTravelMatrix([
      settings.area.base,
      ...stops.map((booking) => toLocation(booking)),
    ]);
    const problem: DispoProblem = {
      forbidden,
      stops: stops.map((booking) => {
        const slotStart = timeToMinutes(booking.slotKey.split('T')[1] ?? '00:00');
        return {
          id: booking.id,
          slotStart,
          slotEnd: slotStart + NIKOLAUS_SLOT_MINUTES,
          duration: visitMinutes(booking.childrenCount),
        };
      }),
      teams: teams(date),
      travel: travel.minutes,
    };
    const slotKeys = new Map(stops.map((booking) => [booking.id, booking.slotKey]));
    const plan = evaluateDispo(problem, solveDispo(problem));
    const entries = plan.routes.flatMap((route) =>
      route.stops.map((stop, index) => ({
        bookingId: stop.id,
        team: route.team,
        order: index + 1,
        slotKey: slotKeys.get(stop.id) ?? '',
        plannedArrival: minutesToTime(stop.start),
        fixed: false,
      }))
    );
    await saveDispo(date, entries, getDispoVersion([]));
  }
}
