import { lockResource } from './db';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import sharp from 'sharp';
import { retentionStart } from './anwesenheit';
import { STUFE_SLUGS } from './anwesenheit-model';
import { storeBlogImageFiles } from './blog-images';
import {
  addBlogImage,
  createBlogPost,
  getBlogEntries,
  getBlogEntry,
  updateBlogPost,
} from './blog-list';
import { neuerInhalt } from './protokoll-editor-model';
import { createQuestionAndAnswer, getStaffQuestionsAndAnswers } from './qa-list';
import { getDb, inTransaction } from './db';
import { validateBlogPost, validateQuestionAndAnswer } from './pflege-validation';
import type { Database } from './db-schema';
import { getAllBookings } from './nikolaus-bookings';
import { toLocation } from './nikolaus-api';
import { NIKOLAUS_SLOT_MINUTES, dateToLocalParts, getNikolausTeams } from './nikolaus-config';
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
const SEEDED_KEY = 'preview:seeded:15';

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
  const today = new Date(`${dateToLocalParts(now).date}T00:00:00Z`).getTime();
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
  const expired = new Date(`${retentionStart(now)}T00:00:00Z`).getTime() - 14 * DAY_MS;
  for (const [offset, stufe] of Object.values(STUFE_SLUGS).entries()) {
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

/** Invented tasks data, including a source proposal; fills each missing part on retries. */
export async function seedPreviewTasks(): Promise<void> {
  await inTransaction(async (trx) => {
    await lockResource(trx, 'preview:tasks');
    // Titles are editable; remember seeded rows independently of their current content.
    const stateKey = 'preview:tasks:ids:1';
    const registry = await trx
      .selectFrom('nikolaus.state')
      .select('value')
      .where('state_key', '=', stateKey)
      .executeTakeFirst();
    const ids: Record<string, number> = {};
    if (registry) {
      const stored: unknown = JSON.parse(registry.value);
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [key, value] of Object.entries(stored)) {
          if (typeof value === 'number' && Number.isInteger(value) && value > 0) ids[key] = value;
        }
      }
    }
    for (const [table, names] of [
      ['organisation.project', ['Herbstaktion']],
      ['organisation.template', ['Aktionsvorbereitung']],
      [
        'organisation.task',
        [
          'Material prüfen',
          'Treffpunkt bestätigt',
          'Lagerküche planen',
          'Material für Winteraktion vorbereiten',
        ],
      ],
    ] as const) {
      for (const title of names)
        await trx
          .updateTable(table)
          .set({ title })
          .where('title', '=', `Preview: ${title}`)
          .where('updated_by', '=', PREVIEW_ACTOR)
          .execute();
    }
    let project = await trx
      .selectFrom('organisation.project')
      .select('id')
      .where((eb) => (ids.project ? eb('id', '=', ids.project) : eb('title', '=', 'Herbstaktion')))
      .executeTakeFirst();
    if (!project)
      project = await trx
        .insertInto('organisation.project')
        .values({ title: 'Herbstaktion', campflow_id: '', updated_by: PREVIEW_ACTOR })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
    ids.project = project.id;
    let template = await trx
      .selectFrom('organisation.template')
      .select('id')
      .where((eb) =>
        ids.template ? eb('id', '=', ids.template) : eb('title', '=', 'Aktionsvorbereitung')
      )
      .executeTakeFirst();
    if (!template)
      template = await trx
        .insertInto('organisation.template')
        .values({
          title: 'Aktionsvorbereitung',
          updated_by: PREVIEW_ACTOR,
          items: JSON.stringify([
            {
              title: 'Material prüfen',
              description: 'Zelte und Spiele durchsehen.',
              assignee: '',
              daysBefore: 7,
            },
          ]),
        })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
    ids.template = template.id;
    const checklist = await trx
      .selectFrom('organisation.checklist')
      .select('project_id')
      .where('project_id', '=', project.id)
      .where('template_id', '=', template.id)
      .executeTakeFirst();
    if (!checklist)
      await trx
        .insertInto('organisation.checklist')
        .values({ project_id: project.id, template_id: template.id })
        .execute();
    for (const entry of [
      {
        key: 'material',
        title: 'Material prüfen',
        state: 'offen' as const,
        quote: '',
        source_id: '',
        source_version: '',
      },
      {
        key: 'treffpunkt',
        title: 'Treffpunkt bestätigt',
        state: 'erledigt' as const,
        quote: '',
        source_id: '',
        source_version: '',
      },
      {
        key: 'lagerkueche',
        title: 'Lagerküche planen',
        state: 'vorschlag' as const,
        quote: 'Alex plant die Lagerküche.',
        source_id: 'preview-protokoll',
        source_version: 'preview-only',
      },
      {
        key: 'projektidee',
        title: 'Material für Winteraktion vorbereiten',
        state: 'vorschlag' as const,
        quote: 'Alex bereitet Material für die Winteraktion vor.',
        source_id: 'preview-projektidee',
        source_version: 'preview-only',
        suggested_project_title: 'Winteraktion',
      },
    ]) {
      const { key, ...values } = entry;
      let existing = await trx
        .selectFrom('organisation.task')
        .select('id')
        .where((eb) => (ids[key] ? eb('id', '=', ids[key]) : eb('title', '=', entry.title)))
        .executeTakeFirst();
      if (!existing)
        existing = await trx
          .insertInto('organisation.task')
          .values({
            ...values,
            project_id: key === 'projektidee' ? null : project.id,
            description:
              key === 'material'
                ? 'Zelte und Spiele für die Herbstaktion durchsehen.'
                : key === 'treffpunkt'
                  ? 'Treffpunkt für die Aktion ist abgestimmt.'
                  : 'Vorbereitung für die nächste gemeinsame Aktion.',
            assignee: 'alex@example.test',
            assignees: JSON.stringify(
              values.state === 'offen'
                ? [
                    { name: 'Alex Beispiel', login: 'alex@example.test' },
                    { name: 'Bea Beispiel', login: 'bea@example.test' },
                  ]
                : [{ name: 'Alex Beispiel', login: 'alex@example.test' }]
            ),
            due_date: '2026-11-01',
            updated_by: PREVIEW_ACTOR,
          })
          .output('inserted.id')
          .executeTakeFirstOrThrow();
      ids[key] = existing.id;
    }
    const recognition = await trx
      .selectFrom('organisation.task_recognition')
      .select('source_id')
      .where('source_id', '=', 'preview-projektidee')
      .where('source_version', '=', 'preview-only')
      .executeTakeFirst();
    if (!recognition)
      await trx
        .insertInto('organisation.task_recognition')
        .values({ source_id: 'preview-projektidee', source_version: 'preview-only' })
        .execute();
    const reminder = await trx
      .selectFrom('organisation.task_reminder_delivery')
      .select('id')
      .where('reminder_day', '=', '2026-10-12')
      .where('recipient', '=', 'alex@example.test')
      .executeTakeFirst();
    if (!reminder)
      await trx
        .insertInto('organisation.task_reminder_delivery')
        .values({
          reminder_day: '2026-10-12',
          recipient: 'alex@example.test',
          status: 'sent',
          sent_at: new Date('2026-10-12T07:17:00Z'),
        })
        .execute();
    if (registry) {
      await trx
        .updateTable('nikolaus.state')
        .set({ value: JSON.stringify(ids) })
        .where('state_key', '=', stateKey)
        .execute();
    } else {
      await trx
        .insertInto('nikolaus.state')
        .values({ state_key: stateKey, value: JSON.stringify(ids) })
        .execute();
    }
  });
}

/** Invented metadata only; never import SharePoint production columns into previews. */
export async function seedPreviewProtokolle(): Promise<void> {
  await inTransaction(async (trx) => {
    await trx
      .updateTable('organisation.protokoll_cutover')
      .set({ mode: 'sql', sql_started: true })
      .where('id', '=', 1)
      .execute();
    if (
      !(await trx
        .selectFrom('organisation.protokoll_import')
        .select('drive_id')
        .where('drive_id', '=', '*preview*')
        .executeTakeFirst())
    ) {
      await trx
        .insertInto('organisation.protokoll_import')
        .values({ drive_id: '*preview*' })
        .execute();
    }
    if (
      !(await trx
        .selectFrom('organisation.protokoll')
        .select('item_id')
        .where('drive_id', '=', 'preview-documents')
        .where('item_id', '=', 'preview-protokoll')
        .executeTakeFirst())
    ) {
      await trx
        .insertInto('organisation.protokoll')
        .values({
          drive_id: 'preview-documents',
          item_id: 'preview-protokoll',
          fields: JSON.stringify({ Status: 'Review', ErstelltVon: 'alex@example.test' }),
          legacy_fields: null,
          legacy_etag: null,
        })
        .execute();
    }
  });
}

/** Invented Altleitende and others to pick in the minutes (#301); skipped if there are some. */
export async function seedPreviewWeiterePersonen(): Promise<void> {
  const exists = await getDb().selectFrom('organisation.person').select('id').executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.person')
    .values([
      { name: 'Anna Altleiterin', gruppe: 'altleitende', updated_by: PREVIEW_ACTOR },
      { name: 'Otto Ehemalig', gruppe: 'altleitende', updated_by: PREVIEW_ACTOR },
      { name: 'Erika Elternbeirat', gruppe: 'weitere', updated_by: PREVIEW_ACTOR },
      { name: 'Ingo Inaktiv', gruppe: 'weitere', aktiv: false, updated_by: PREVIEW_ACTOR },
    ])
    .execute();
}

/**
 * Minutes in the editor with invented content, so the editor and the live view have something
 * to show. Skipped if the preview has some already.
 */
export async function seedPreviewProtokollEditor(now: Date = new Date()): Promise<void> {
  await seedPreviewProtokollEntwurf(now);
  await seedPreviewProtokollReview(now);
}

const REVIEW_TITLE = 'Stavo-Sitzung (Testdaten)';

/** Minutes waiting for the review, so reviewers can try approving and sending them back. */
async function seedPreviewProtokollReview(now: Date): Promise<void> {
  await inTransaction(async (trx) => {
    const exists = await trx
      .selectFrom('protokoll.protokoll')
      .select('id')
      .where('title', '=', REVIEW_TITLE)
      .executeTakeFirst();
    if (exists) return;
    let n = 0;
    const inhalt = neuerInhalt(() => `seed-review-${++n}`, {
      sitzungsleitung: [{ login: '', name: 'Vera Vorstand' }],
      protokollant: [{ login: '', name: 'Paula Protokoll' }],
      beginn: '20:00',
      ende: '21:00',
      teilnehmende: [
        { login: '', name: 'Vera Vorstand', status: 'anwesend' },
        { login: '', name: 'Volker Vorstand', status: 'anwesend' },
      ],
    });
    inhalt.punkte[1].text = 'Kurzer Rückblick auf das Sommerlager.\n- Alles gut gelaufen';
    const date = dateToLocalParts(new Date(now.getTime() - 9 * DAY_MS)).date;
    await trx
      .insertInto('protokoll.protokoll')
      .values({
        title: REVIEW_TITLE,
        meeting_date: date,
        status: 'review',
        content: JSON.stringify(inhalt),
        created_by: PREVIEW_ACTOR,
        updated_by: PREVIEW_ACTOR,
        submitted_at: now,
        submitted_by: PREVIEW_ACTOR,
      })
      .execute();
  });
}

async function seedPreviewProtokollEntwurf(now: Date): Promise<void> {
  await inTransaction(async (trx) => {
    const exists = await trx
      .selectFrom('protokoll.protokoll')
      .select('id')
      .where('title', '!=', REVIEW_TITLE)
      .executeTakeFirst();
    if (exists) return;
    let n = 0;
    const inhalt = neuerInhalt(() => `seed-${++n}`, {
      sitzungsleitung: [
        { login: '', name: 'Vera Vorstand' },
        { login: '', name: 'Volker Vorstand' },
      ],
      protokollant: [{ login: '', name: 'Paula Protokoll' }],
      beginn: '19:30',
      ende: '21:15',
      teilnehmende: [
        { login: '', name: 'Lea Leiterin', status: 'anwesend' },
        { login: '', name: 'Max Muster', status: 'anwesend' },
        { login: '', name: 'Tom Test', status: 'entschuldigt' },
      ],
      externe: 'Elternbeirat (Testdaten)',
    });
    const [stufen, reflexion, planung] = inhalt.punkte;
    stufen.unterpunkte[0].text =
      'Gruppenstunde zum Thema Erste Hilfe, **12 Kinder** da.\n- Neue Jacken bestellt\n- Ausflug geplant';
    reflexion.text =
      'Der Stammestag war gut besucht. Nächstes Mal _früher_ mit dem Aufbau anfangen.\n\n' +
      '1. Aufbau ab 9 Uhr\n2. Mehr Helfende für die Küche\n\n- [x] Fotos hochgeladen\n- [ ] Dankesmail';
    planung.titel = 'Pfingstlager (Testdaten)';
    planung.aktion = {
      id: 'evt_preview',
      titel: 'Pfingstlager (Testdaten)',
      start: '2027-05-14',
      ende: '2027-05-17',
    };
    planung.text = 'Zeltplatz ist reserviert, Anzahlung steht noch aus.';
    planung.aufgaben = [
      {
        id: `seed-${++n}`,
        titel: 'Anzahlung für den Zeltplatz überweisen',
        zustaendig: [{ login: '', name: 'Vera Vorstand' }],
        faellig: dateToLocalParts(new Date(now.getTime() + 7 * DAY_MS)).date,
      },
    ];
    planung.termine = [
      {
        id: `seed-${++n}`,
        titel: 'Vortreffen Pfingstlager',
        datum: dateToLocalParts(new Date(now.getTime() + 21 * DAY_MS)).date,
        uhrzeit: '18:00',
        ort: 'Stammesheim',
        zustaendig: [{ login: '', name: 'Lea Leiterin' }],
      },
    ];
    inhalt.naechsteSitzung = {
      datum: dateToLocalParts(new Date(now.getTime() + 14 * DAY_MS)).date,
      uhrzeit: '19:30',
      ort: 'Stammesheim',
    };
    const content = JSON.stringify(inhalt);
    const date = dateToLocalParts(new Date(now.getTime() - 2 * DAY_MS)).date;
    const { id } = await trx
      .insertInto('protokoll.protokoll')
      .values({
        title: 'Leitendenrunde (Testdaten)',
        meeting_date: date,
        content,
        created_by: PREVIEW_ACTOR,
        updated_by: PREVIEW_ACTOR,
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('protokoll.revision')
      .values({
        protokoll_id: id,
        title: 'Leitendenrunde (Testdaten)',
        meeting_date: date,
        content,
        reason: 'speichern',
        saved_at: now,
        saved_by: PREVIEW_ACTOR,
      })
      .execute();
  });
}
