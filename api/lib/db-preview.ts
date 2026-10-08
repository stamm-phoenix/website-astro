import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import sharp from 'sharp';
import { berlinToday, retentionStart } from './anwesenheit';
import { storeBlogImageFiles } from './blog-images';
import {
  addBlogImage,
  createBlogPost,
  getBlogEntries,
  getBlogEntry,
  updateBlogPost,
} from './blog-list';
import { createQuestionAndAnswer, getStaffQuestionsAndAnswers } from './qa-list';
import { inTransaction } from './db';
import { STUFEN, validateBlogPost, validateQuestionAndAnswer } from './pflege-validation';
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
// As long as the statements in master may take (scripts/db-preview.ts)
const READY_TIMEOUT_MS = 10 * 60_000;

function checkPr(pr: string | number): string {
  const value = String(pr);
  if (!PR_NUMBER.test(value)) throw new Error(`Invalid pull request number: ${value}`);
  return value;
}

/** The database of a PR preview; throws for anything that is not a PR number. */
export function previewDatabaseName(pr: string | number): string {
  return `website-pr-${checkPr(pr)}`;
}

/** The blob container of a PR preview, in the preview storage account (`CONFIG.storage`). */
export function previewContainerName(pr: string | number): string {
  return `pr-${checkPr(pr)}`;
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
const SEEDED_KEY = 'preview:seeded:4';

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

const PREVIEW_ACTOR = 'preview';

/** Invented questions; one draft shows the publication status. */
const PREVIEW_FAQ = [
  {
    question: 'Ab welchem Alter kann man mitmachen?',
    answer: '<p>Die Wölflinge starten mit <strong>sieben Jahren</strong>.</p>',
    category: 'Mitmachen',
    published: true,
  },
  {
    question: 'Was kostet eine Mitgliedschaft?',
    answer: '<p>Der Beitrag ist ein Testwert der Preview.</p>',
    category: 'Mitgliedschaft',
    published: true,
  },
  {
    question: 'Was ziehe ich zur Gruppenstunde an?',
    answer: '<p>Etwas, das dreckig werden darf.</p>',
    category: 'Gruppenstunden',
    published: true,
  },
  {
    question: 'Entwurf: Wie läuft das Sommerlager ab?',
    answer: '',
    category: 'Lager',
    published: false,
  },
];

/** Adds the invented questions that are missing (matched by question). */
export async function seedPreviewQuestions(): Promise<void> {
  const existing = new Set((await getStaffQuestionsAndAnswers()).map((entry) => entry.question));
  for (const entry of PREVIEW_FAQ) {
    if (existing.has(entry.question)) continue;
    await createQuestionAndAnswer(validateQuestionAndAnswer(entry), PREVIEW_ACTOR);
  }
}

/** A plain test picture: a diagonal gradient in the given colors. */
function testPicture(width: number, height: number, from: string, to: string): Promise<Buffer> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/>` +
    `<stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

interface PreviewPost {
  title: string;
  date: string;
  published: boolean;
  /** Text without and with the images (`{0}`, `{1}` stand for their file names). */
  content: string;
  contentWithImages?: string;
  /** Gradient colors of the test pictures. */
  images: [string, string][];
}

/** One post with images (stored in the preview's blob container), one without and a draft. */
const PREVIEW_POSTS: PreviewPost[] = [
  {
    title: 'Testbeitrag: Sommerlager',
    date: '2026-08-20',
    published: true,
    content: '<p>Dieser Beitrag ist erfunden und nur in der Preview zu sehen.</p>',
    contentWithImages:
      '<p>Dieser Beitrag ist erfunden und nur in der Preview zu sehen.</p>' +
      '<img data-bild="{1}"><p>Zweiter Absatz unter dem zweiten Bild.</p>',
    images: [
      ['#003056', '#810a1a'],
      ['#2a7a3b', '#f2b705'],
    ],
  },
  {
    title: 'Testbeitrag: Waldweihnacht',
    date: '2026-12-14',
    published: true,
    content: '<h2>Ohne Bilder</h2><p>Auch dieser Beitrag ist erfunden.</p>',
    images: [],
  },
  {
    title: 'Entwurf: Jahresrückblick',
    date: '2026-12-31',
    published: false,
    content: '<p>Noch nicht fertig.</p>',
    images: [],
  },
];

/**
 * Adds the invented posts that are missing (matched by title) and the images a post lacks,
 * e.g. after a run that stopped halfway. Image files get fixed names, so a retry overwrites
 * the files of an image that was stored but not recorded.
 */
export async function seedPreviewBlog(): Promise<void> {
  const entries = await getBlogEntries();
  for (const post of PREVIEW_POSTS) {
    let entry = entries.find((candidate) => candidate.title === post.title);
    if (!entry) {
      const input = { title: post.title, date: post.date, published: post.published };
      const { id } = await createBlogPost(
        validateBlogPost({ ...input, content: post.content }, []),
        PREVIEW_ACTOR
      );
      entry = await getBlogEntry(id);
      if (!entry) throw new Error(`Preview post ${id} vanished`);
    }
    if (post.images.length === 0) continue;

    const files = post.images.map((_colors, index) => `bild-${1_700_000_000_000 + index}.jpg`);
    let etag = entry.etag;
    for (const [index, [from, to]] of post.images.entries()) {
      if (entry.images.some((image) => image.file === files[index])) continue;
      const image = {
        file: files[index],
        alt: `Testbild ${index + 1}`,
        width: 1600,
        height: 1067,
      };
      await storeBlogImageFiles(entry.id, image, await testPicture(1600, 1067, from, to));
      etag = (await addBlogImage(entry.id, image, etag, PREVIEW_ACTOR)).etag;
    }
    if (post.contentWithImages && !entry.content.includes('data-bild')) {
      const content = files.reduce(
        (text, file, index) => text.replaceAll(`{${index}}`, file),
        post.contentWithImages
      );
      await updateBlogPost(
        entry.id,
        validateBlogPost(
          { title: post.title, date: post.date, published: post.published, content },
          files
        ),
        etag,
        PREVIEW_ACTOR
      );
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Invented contents of the preview Termine, without names of children. */
const PREVIEW_NOTES = [
  'Knoten geübt und eine Seilbrücke gebaut.',
  'Geländespiel im Wald.',
  'Lagerfeuer mit Stockbrot.',
  'Erste Hilfe: Verbände anlegen.',
];

/**
 * Weekly Termine of the last eight weeks per Stufe and two from before the retention period,
 * with invented contents and guests. Members are stored as anonymized rows, so no CampFlow ID
 * gets into a preview. The dates count from the Monday of the current week, so a retry in the
 * same week adds only the Termine that are missing.
 */
export async function seedPreviewAttendance(now: Date = new Date()): Promise<void> {
  const today = new Date(`${berlinToday(now)}T00:00:00Z`).getTime();
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
  const expired = new Date(`${retentionStart(now)}T00:00:00Z`).getTime() - 14 * DAY_MS;
  for (const [offset, stufe] of STUFEN.entries()) {
    const recent = [...Array(8).keys()].map((week) => monday - (week + 1) * 7 * DAY_MS);
    const old = [expired, expired - 7 * DAY_MS];
    for (const [index, time] of [...recent, ...old].entries()) {
      const date = new Date(time + offset * DAY_MS).toISOString().slice(0, 10);
      // Termin and attendance in one transaction, so a run that stops halfway leaves no empty Termin
      await inTransaction(async (trx) => {
        const exists = await trx
          .selectFrom('gruppenstunde.meeting')
          .select('id')
          .where('stufe', '=', stufe)
          .where('date', '=', date)
          .executeTakeFirst();
        if (exists) return;
        const { id } = await trx
          .insertInto('gruppenstunde.meeting')
          .values({
            stufe,
            date,
            notes: PREVIEW_NOTES[(index + offset) % PREVIEW_NOTES.length],
            updated_by: PREVIEW_ACTOR,
          })
          .output('inserted.id')
          .executeTakeFirstOrThrow();
        const members = Array.from({ length: 5 + ((index + offset) % 4) }, () => ({
          meeting_id: id,
          guest: false,
          person_id: null,
          guest_name: null,
        }));
        const guests =
          index % 3 === 0
            ? [
                {
                  meeting_id: id,
                  guest: true,
                  person_id: null,
                  guest_name: index < recent.length ? `Testgast ${index + 1}` : null,
                },
              ]
            : [];
        await trx
          .insertInto('gruppenstunde.attendance')
          .values([...members, ...guests])
          .execute();
      });
    }
  }
}
