import { createHash } from 'node:crypto';
import { CONFIG } from './config';
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
import { validateAbstimmung } from './abstimmung-model';
import { createAbstimmung, queueAbstimmungEinladungen, voteAsStaff } from './abstimmungen';
import { createQuestionAndAnswer, getStaffQuestionsAndAnswers } from './qa-list';
import { createGruppenstunde, getStaffGruppenstunden } from './gruppenstunden-list';
import { createLeitende, getStaffLeitende, setLeitendePhoto } from './leitende-list';
import { createAktion, getStaffAktionen } from './aktionen-list';
import { createBeleg, getBelege } from './beleg-list';
import { nextContentId } from './content-ids';
import { completeUpload, listDownloads, newDownloadKey, stageUploadPart } from './downloads';
import { getDb, inTransaction } from './db';
import {
  LEITENDE_STUFE,
  STUFEN,
  validateAktion,
  validateBeleg,
  validateBlogPost,
  validateGruppenstunde,
  validateLeitende,
  validateQuestionAndAnswer,
} from './pflege-validation';
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
import {
  createSammelCampaign,
  ensureSammelOrder,
  getSammelCampaign,
  getSammelOrder,
  setSammelCampaignArchived,
  updateSammelOrder,
} from './sammelbestellung-list';
import type { SammelOrderChanges } from './sammelbestellung-list';
import { validateSammelCampaign } from './sammelbestellung-validation';
import type { SammelPaymentEvent, SammelPaymentRecord } from './sammelbestellung-payment-model';

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
const SEEDED_KEY = 'preview:seeded:33';

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
          (member) => conflictingTags(member, [booking.internalTags], member.role).length > 0
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
    answer:
      '<p>Der Beitrag ist ein Testwert der Preview. Fragen dazu an <a href="mailto:kontakt@stamm-phoenix.de">kontakt@stamm-phoenix.de</a>.</p>',
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

/** Index of the recent Termin that is seeded as cancelled, and of the one without notes. */
const PREVIEW_CANCELLED = 5;
const PREVIEW_WITHOUT_NOTES = 6;

/**
 * Weekly Termine of the last eight weeks per Stufe and two from before the retention period,
 * with invented contents, excused children and guests; one Termin is cancelled and one has no
 * notes. Members are stored as anonymized rows, so no CampFlow ID
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
        const cancelled = index === PREVIEW_CANCELLED;
        const notes = cancelled
          ? 'Fällt aus wegen der Ferien.'
          : index === PREVIEW_WITHOUT_NOTES
            ? ''
            : PREVIEW_NOTES[(index + offset) % PREVIEW_NOTES.length];
        const { id } = await trx
          .insertInto('gruppenstunde.meeting')
          .values({ stufe, date, notes, cancelled, updated_by: PREVIEW_ACTOR })
          .output('inserted.id')
          .executeTakeFirstOrThrow();
        if (cancelled) return;
        const member = (excused: boolean) => ({
          meeting_id: id,
          guest: false,
          person_id: null,
          guest_name: null,
          excused,
        });
        const members = [
          ...Array.from({ length: 5 + ((index + offset) % 4) }, () => member(false)),
          ...Array.from({ length: 1 + (index % 2) }, () => member(true)),
        ];
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
    const rundeReminder = await trx
      .selectFrom('protokoll.erinnerung')
      .select('id')
      .where('meeting_key', '=', '2026-10-14T19:00')
      .where('days_before', '=', 7)
      .executeTakeFirst();
    if (!rundeReminder)
      await trx
        .insertInto('protokoll.erinnerung')
        .values({
          meeting_key: '2026-10-14T19:00',
          meeting_date: '2026-10-14',
          meeting_at: new Date('2026-10-14T17:00:00Z'),
          protokoll_ref: 'editor:0',
          days_before: 7,
          recipient_hash: 'a'.repeat(64),
          status: 'sent',
          sent_at: new Date('2026-10-07T07:47:00Z'),
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
    if (
      !(await trx
        .selectFrom('organisation.protokoll_content_version')
        .select('item_id')
        .where('drive_id', '=', 'preview-documents')
        .where('item_id', '=', 'preview-protokoll')
        .executeTakeFirst())
    ) {
      await trx
        .insertInto('organisation.protokoll_content_version')
        .values({
          drive_id: 'preview-documents',
          item_id: 'preview-protokoll',
          ctag: '"c:{preview-protokoll},1"',
          content_version: 'docx-word-sha256:' + '0'.repeat(64),
        })
        .execute();
    }
  });
}

/** Invented Altleitende and others to pick in the minutes (#301); skipped if there are some. */
export async function seedPreviewPersonen(): Promise<void> {
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
 * An invented CampFlow Aktion without KJR grant, so the table has a row; it matches no real
 * Aktion. Skipped if the preview has one already.
 */
export async function seedPreviewAktionenOhneZuschuss(): Promise<void> {
  const exists = await getDb()
    .selectFrom('organisation.aktion_ohne_zuschuss')
    .select('campflow_id')
    .executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.aktion_ohne_zuschuss')
    .values({ campflow_id: 'evt_PreviewExtern', created_by: PREVIEW_ACTOR })
    .execute();
}

/**
 * An invented CampFlow event that is no real Aktion, so the table has a row; it matches no real
 * event. Skipped if the preview has one already.
 */
export async function seedPreviewKeineAktionen(): Promise<void> {
  const exists = await getDb()
    .selectFrom('organisation.aktion_keine_aktion')
    .select('campflow_id')
    .executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.aktion_keine_aktion')
    .values({ campflow_id: 'evt_PreviewPulli', created_by: PREVIEW_ACTOR })
    .execute();
}

/**
 * Favorites of an invented account, so the table has a row; real logins of the preview save
 * their own. Skipped if the preview has favorites already.
 */
export async function seedPreviewStaffFavorites(): Promise<void> {
  const exists = await getDb()
    .selectFrom('organisation.staff_favorites')
    .select('user_id')
    .executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.staff_favorites')
    .values({
      user_id: 'preview-favoriten',
      login: 'vorschau@example.test',
      modules: JSON.stringify(['/leitendenbereich/aufgaben', '/leitendenbereich/aktionen']),
    })
    .execute();
}

/**
 * Recently used areas of an invented account, so the table has a row; real logins of the preview
 * collect their own. Skipped if the preview has some already.
 */
export async function seedPreviewStaffRecent(): Promise<void> {
  const exists = await getDb()
    .selectFrom('organisation.staff_recent')
    .select('user_id')
    .executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.staff_recent')
    .values({
      user_id: 'preview-zuletzt',
      login: 'vorschau@example.test',
      modules: JSON.stringify(['/leitendenbereich/belege', '/leitendenbereich/fotos']),
    })
    .execute();
}

/**
 * One invented account that has seen an early changelog entry, so the table has a row; real
 * logins of the preview start without one and see every entry as new. Skipped if the preview
 * has some already.
 */
export async function seedPreviewStaffChangelogSeen(): Promise<void> {
  const exists = await getDb()
    .selectFrom('organisation.staff_changelog_seen')
    .select('user_id')
    .executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.staff_changelog_seen')
    .values({
      user_id: 'preview-neuigkeiten',
      login: 'vorschau@example.test',
      last_seen_id: '2026-09-25-01-leitendenbereich',
    })
    .execute();
}

/** Invented personal Abrechnung draft; no real participant data. */
export async function seedPreviewAbrechnungEingabe(): Promise<void> {
  const db = getDb();
  const exists = await db
    .selectFrom('organisation.abrechnung_eingabe')
    .select('user_id')
    .executeTakeFirst();
  if (exists) return;
  await db
    .insertInto('organisation.abrechnung_eingabe')
    .values({
      user_id: 'preview-abrechnung',
      event_id: 'evt_Preview26',
      login: 'vorschau@example.test',
      session: JSON.stringify({
        zusatztag: false,
        excluded: {},
        extra: [],
        betreuer: {},
        plz: {},
        kjr: { ort: 'Musterort', plz: '83620', beginn: '', ende: '' },
        leihgebuehren: {},
        deckblatt: { vorkalkulation: '', kalkulation: '' },
        betraege: {},
      }),
      delete_after: sql<Date>`DATEADD(month, 4, CONVERT(date, SYSUTCDATETIME()))`,
    })
    .execute();
}

/** One invented person who writes the minutes in Markdown; everyone else has the default. */
export async function seedPreviewStaffSettings(): Promise<void> {
  const exists = await getDb()
    .selectFrom('organisation.staff_settings')
    .select('user_id')
    .executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.staff_settings')
    .values({
      user_id: 'preview-einstellungen',
      login: 'vorschau@example.test',
      settings: JSON.stringify({ protokollText: 'markdown' }),
    })
    .execute();
}

/** Invented Gruppenstunden, one per Stufe (matched by Stufe). */
const PREVIEW_GRUPPENSTUNDEN = [
  { weekday: 'Montags', time: '17:00 – 18:30 Uhr', ageRange: '7 – 10 Jahre' },
  { weekday: 'Dienstags', time: '17:30 – 19:00 Uhr', ageRange: '10 – 13 Jahre' },
  { weekday: 'Mittwochs', time: '18:00 – 19:30 Uhr', ageRange: '13 – 16 Jahre' },
  { weekday: 'Freitags', time: '19:00 – 21:00 Uhr', ageRange: '16 – 20 Jahre' },
];

export async function seedPreviewGruppenstunden(): Promise<void> {
  const existing = new Set((await getStaffGruppenstunden()).map((item) => item.stufe));
  for (const [index, stufe] of STUFEN.entries()) {
    if (existing.has(stufe)) continue;
    const input = {
      stufe,
      ...PREVIEW_GRUPPENSTUNDEN[index],
      location: 'Pfarrheim (Testdaten)',
      description: `<p>Erfundene Beschreibung der Gruppenstunde der ${stufe}.</p>`,
    };
    await createGruppenstunde(validateGruppenstunde(input, STUFEN), PREVIEW_ACTOR);
  }
}

/** Invented Leitende with their teams; some with a test photo (matched by name). */
const PREVIEW_LEITENDE: {
  name: string;
  teams: string[];
  photo?: [string, string];
  contact?: { phone: string; street: string; postalCode: string; city: string };
}[] = [
  {
    name: 'Vera Vorstand',
    teams: ['Vorstand'],
    photo: ['#003056', '#810a1a'],
    contact: {
      phone: '0123 456789',
      street: 'Teststraße 1',
      postalCode: '12345',
      city: 'Musterstadt',
    },
  },
  {
    name: 'Volker Vorstand',
    teams: ['Vorstand', 'Rover'],
    contact: {
      phone: '0123 987654',
      street: 'Beispielweg 2',
      postalCode: '12345',
      city: 'Musterstadt',
    },
  },
  { name: 'Lea Leiterin', teams: ['Wölflinge'], photo: ['#f28c00', '#f2b705'] },
  { name: 'Max Muster', teams: ['Wölflinge', 'Jungpfadfinder'] },
  { name: 'Tom Test', teams: ['Jungpfadfinder'], photo: ['#2f53a7', '#8ab4f8'] },
  { name: 'Paula Protokoll', teams: ['Pfadfinder'], photo: ['#2a7a3b', '#a8d5b0'] },
  { name: 'Rita Rover', teams: ['Rover'] },
];

export async function seedPreviewLeitende(): Promise<void> {
  let people = await getStaffLeitende();
  for (const person of PREVIEW_LEITENDE) {
    if (people.some((candidate) => candidate.name === person.name)) continue;
    const input = { name: person.name, teams: person.teams, ...person.contact };
    await createLeitende(validateLeitende(input, person.teams), PREVIEW_ACTOR);
  }
  people = await getStaffLeitende();
  for (const person of PREVIEW_LEITENDE) {
    const stored = people.find((candidate) => candidate.name === person.name);
    if (!person.photo || !stored || stored.hasImage) continue;
    const [from, to] = person.photo;
    await setLeitendePhoto(
      Number(stored.id),
      await testPicture(600, 600, from, to),
      stored.etag,
      PREVIEW_ACTOR
    );
  }
}

/** Invented calendar entries without CampFlow (matched by title). */
const PREVIEW_AKTIONEN: { title: string; stufen: string[]; days: number; length: number }[] = [
  { title: 'Stammeswochenende (Testdaten)', stufen: [...STUFEN], days: 30, length: 2 },
  {
    title: 'Waldweihnacht (Testdaten)',
    stufen: ['Wölflinge', 'Jungpfadfinder'],
    days: 60,
    length: 0,
  },
  { title: 'Leitendenrunde (Testdaten)', stufen: [LEITENDE_STUFE], days: 10, length: 0 },
];

export async function seedPreviewAktionen(now: Date = new Date()): Promise<void> {
  const existing = new Set((await getStaffAktionen()).map((entry) => entry.title));
  for (const aktion of PREVIEW_AKTIONEN) {
    if (existing.has(aktion.title)) continue;
    const start = dateToLocalParts(new Date(now.getTime() + aktion.days * DAY_MS)).date;
    const end = dateToLocalParts(
      new Date(now.getTime() + (aktion.days + aktion.length) * DAY_MS)
    ).date;
    const input = {
      title: aktion.title,
      stufen: aktion.stufen,
      start,
      end,
      link: '',
      description: '<p>Dieser Termin ist erfunden und nur in der Preview zu sehen.</p>',
    };
    await createAktion(validateAktion(input, [...STUFEN, LEITENDE_STUFE]), PREVIEW_ACTOR);
  }
}

/** Invented receipts in every state, one of them a scan with its original (matched by shop). */
const PREVIEW_BELEGE: {
  shop: string;
  days: number;
  amountCent: number;
  status: 'Eingereicht' | 'Angenommen' | 'Abgelehnt';
  reviewNote: string;
  scan: boolean;
}[] = [
  {
    shop: 'Testmarkt (Testdaten)',
    days: 3,
    amountCent: 2350,
    status: 'Eingereicht',
    reviewNote: '',
    scan: true,
  },
  {
    shop: 'Baumarkt (Testdaten)',
    days: 12,
    amountCent: 8990,
    status: 'Angenommen',
    reviewNote: '',
    scan: false,
  },
  {
    shop: 'Bäckerei (Testdaten)',
    days: 20,
    amountCent: 1240,
    status: 'Abgelehnt',
    reviewNote: 'Der Betrag ist auf dem Foto nicht lesbar.',
    scan: false,
  },
];

export async function seedPreviewBelege(now: Date = new Date()): Promise<void> {
  const existing = new Set((await getBelege()).map((beleg) => beleg.shop));
  for (const beleg of PREVIEW_BELEGE) {
    if (existing.has(beleg.shop)) continue;
    const date = dateToLocalParts(new Date(now.getTime() - beleg.days * DAY_MS)).date;
    const input = validateBeleg(
      {
        shop: beleg.shop,
        date,
        amountCent: beleg.amountCent,
        paidBy: 'Lea Leiterin',
        payout: true,
        // Both exist in CampFlow, so a test transfer from a preview creates nothing there
        kostenstelle: 'Allgemein',
        kategorie: 'Material',
        note: '',
        status: beleg.status,
        reviewNote: beleg.reviewNote,
      },
      dateToLocalParts(now).date
    );
    const photo = await testPicture(1200, 1600, '#f4f1e8', '#d8d2c0');
    const original = beleg.scan ? await testPicture(1600, 1200, '#8a8070', '#d8d2c0') : undefined;
    await createBeleg(input, PREVIEW_ACTOR, { photo, original }, undefined);
  }
}

/**
 * Invented receipts already transferred to CampFlow, for the list „In CampFlow“ (matched by
 * shop). Only rows: CampFlow is never called, and the image of such a receipt comes from
 * CampFlow, so in a preview it shows that CampFlow does not know the number.
 */
const PREVIEW_UEBERTRAGEN: { shop: string; days: number; amountCent: number; number: string }[] = [
  { shop: 'Getränkemarkt (Testdaten)', days: 30, amountCent: 4580, number: 'TEST-1' },
  { shop: 'Schreibwaren (Testdaten)', days: 45, amountCent: 1299, number: 'TEST-2' },
];

export async function seedPreviewBelegeCampflow(now: Date = new Date()): Promise<void> {
  const existing = new Set(
    (await getDb().selectFrom('organisation.beleg_campflow').select('shop').execute()).map(
      (row) => row.shop
    )
  );
  for (const beleg of PREVIEW_UEBERTRAGEN) {
    if (existing.has(beleg.shop)) continue;
    const at = new Date(now.getTime() - beleg.days * DAY_MS);
    const date = dateToLocalParts(at).date;
    await inTransaction(async (trx) => {
      // An ID of its own, so no receipt of the preview ever gets it
      const id = await nextContentId(trx, 'organisation.beleg');
      await trx
        .insertInto('organisation.beleg_campflow')
        .values({
          beleg_id: id,
          state: 'Hochgeladen',
          file_name: `${date} ${beleg.shop} (Website-Beleg ${id}).jpg`,
          costunit_id: 'cun_Testdaten',
          costunit_name: 'Stammeswochenende (Testdaten)',
          category_id: 'cat_Testdaten',
          category_name: 'Verpflegung',
          shop: beleg.shop,
          beleg_date: date,
          amount_cent: beleg.amountCent,
          paid_by: 'Lea Leiterin',
          payout: true,
          aktion: 'Stammeswochenende (Testdaten)',
          note: '',
          // The preview's test account sees them also without being part of the Kasse
          submitted_by: CONFIG.staff.previewOnlyLogins[0] ?? PREVIEW_ACTOR,
          beleg_version: Buffer.alloc(8),
          campflow_number: beleg.number,
          started_by: PREVIEW_ACTOR,
          started_at: at.toISOString(),
          uploaded_at: at.toISOString(),
          beleg_deleted_at: at.toISOString(),
        })
        .execute();
    });
  }
}

/** A one-page PDF with a line of text, small enough to be built by hand. */
export function testPdf(text: string): Buffer {
  const escaped = text.replace(/[\\()]/g, (char) => `\\${char}`).replace(/[^\x20-\x7e]/g, '?');
  const stream = `BT /F1 18 Tf 72 760 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Invented downloads, two with a preview (matched by file name). */
const PREVIEW_DOWNLOADS: { fileName: string; text: string; preview?: [string, string] }[] = [
  {
    fileName: 'Packliste Sommerlager (Testdaten).pdf',
    text: 'Packliste Sommerlager - Testdaten der Preview',
    preview: ['#ffffff', '#c9d6e3'],
  },
  {
    fileName: 'Anmeldung Stammeswochenende (Testdaten).pdf',
    text: 'Anmeldung Stammeswochenende - Testdaten der Preview',
    preview: ['#ffffff', '#e3d3c9'],
  },
  { fileName: 'Liederliste (Testdaten).txt', text: 'Liederliste - Testdaten der Preview' },
];

export async function seedPreviewDownloads(): Promise<void> {
  const existing = new Set((await listDownloads()).map((file) => file.fileName));
  for (const file of PREVIEW_DOWNLOADS) {
    if (existing.has(file.fileName)) continue;
    const key = newDownloadKey();
    const bytes = file.fileName.endsWith('.pdf')
      ? testPdf(file.text)
      : Buffer.from(`${file.text}\n`, 'utf8');
    await stageUploadPart(key, 0, bytes);
    const preview = file.preview && (await testPicture(420, 594, ...file.preview));
    const result = await completeUpload(
      { key, fileName: file.fileName, size: bytes.length, replace: false, preview },
      PREVIEW_ACTOR
    );
    if (result.status !== 'saved')
      throw new Error(`Preview download ${file.fileName}: ${result.status}`);
  }
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

/** Minutes waiting for the review, so testers can try approving and sending them back. */
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
    // Approving the minutes creates this task in the project of the item (#277, step 3)
    const project = await trx
      .selectFrom('organisation.project')
      .select(['id', 'title'])
      .where('title', '=', 'Herbstaktion')
      .executeTakeFirst();
    inhalt.punkte[2].projekt = project ? { id: project.id, titel: project.title } : null;
    inhalt.punkte[2].aufgaben = [
      {
        id: `seed-review-${++n}`,
        titel: 'Einladung zur Herbstaktion verschicken (Testdaten)',
        zustaendig: [{ login: '', name: 'Volker Vorstand' }],
        faellig: dateToLocalParts(new Date(now.getTime() + 10 * DAY_MS)).date,
      },
    ];
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

/** Fixed retry keys, so a repeated seed finds the campaigns it already created. */
const PREVIEW_SAMMEL_OPEN = '00000000-0000-4000-8000-000000000156';
const PREVIEW_SAMMEL_ARCHIVED = '00000000-0000-4000-8000-000000000157';

function previewDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Invented Sammelbestellungen: an open one with orders in every status (a draft, an order with
 * an excluded article, one with an assigned CampFlow person and a created contribution) and an
 * archived one whose invitations were sent. Only fills what is missing.
 */
export async function seedPreviewSammel(now: Date = new Date()): Promise<void> {
  const day = 86_400_000;
  const at = (offset: number): string =>
    new Date(Math.floor(now.getTime() / day) * day + offset * day).toISOString();
  const kluft = 'https://www.ruesthaus.de/kluft/2891/klufthemd-fairtrade';
  const openId = await createSammelCampaign(
    validateSammelCampaign({
      title: 'Sammelbestellung Herbst (Test)',
      description: 'Erfundene Testdaten der Preview.',
      startsAt: at(-7),
      endsAt: at(21),
      catalog: [
        { name: 'Klufthemd', reference: kluft, variants: ['152', '164', 'S', 'M'] },
        { shop: 'eschwege', name: 'Juja', reference: '3020', variants: ['M', 'L'] },
        { name: 'Halstuch', reference: 'stamm-halstuch', variants: [] },
      ],
    }),
    PREVIEW_SAMMEL_OPEN
  );
  const archivedId = await createSammelCampaign(
    validateSammelCampaign({
      title: 'Sammelbestellung Frühjahr (Test)',
      description: '',
      startsAt: at(-200),
      endsAt: at(-170),
      catalog: [{ name: 'Klufthemd', reference: kluft, variants: ['152', '164'] }],
    }),
    PREVIEW_SAMMEL_ARCHIVED
  );
  const archived = await getSammelCampaign(archivedId);
  if (archived && !archived.archived)
    await setSammelCampaignArchived(archivedId, true, archived.etag);

  const shirt = { name: 'Klufthemd', reference: kluft, variant: '164', quantity: 1 };
  const scarf = { name: 'Halstuch', reference: 'stamm-halstuch', variant: '', quantity: 2 };
  const juja = {
    shop: 'eschwege' as const,
    name: 'Juja',
    reference: '3020',
    variant: 'M',
    quantity: 1,
  };
  const actor = { id: 'preview', name: 'leitung@example.test' };
  const orders: {
    campaign: string;
    email: string;
    changes?: SammelOrderChanges;
    payment?: boolean;
  }[] = [
    // Requested a link but has not ordered yet
    { campaign: openId, email: 'familie.entwurf@example.test' },
    {
      campaign: openId,
      email: 'familie.mueller@example.test',
      changes: { name: 'Familie Müller', items: [shirt, scarf], notes: 'Bitte zusammen abholen.' },
    },
    {
      campaign: openId,
      email: 'familie.schmidt@example.test',
      changes: {
        name: 'Familie Schmidt',
        items: [{ ...juja, excluded: { reason: 'Größe M ist ausverkauft.' } }, shirt],
        status: 'Bestellt',
        totalCents: 4590,
      },
    },
    {
      campaign: openId,
      email: 'familie.weber@example.test',
      changes: { name: 'Familie Weber', items: [shirt], status: 'Bestellt', totalCents: 3490 },
      payment: true,
    },
    {
      campaign: openId,
      email: 'familie.storniert@example.test',
      changes: { name: 'Familie Storniert', items: [scarf], status: 'Storniert' },
    },
    {
      campaign: archivedId,
      email: 'familie.mueller@example.test',
      changes: {
        name: 'Familie Müller',
        items: [{ ...shirt, variant: '152' }],
        status: 'Eingetroffen',
        totalCents: 3490,
        paid: true,
        delivered: true,
      },
    },
  ];
  for (const entry of orders) {
    let order = await ensureSammelOrder(entry.campaign, entry.email);
    if (!entry.changes) continue;
    if (!order.submitted) {
      await updateSammelOrder(
        order.id,
        { submitted: true, linkSentAt: at(-3), ...entry.changes },
        order.etag
      );
      order = (await getSammelOrder(order.id))!;
    }
    // A run that stopped between the order and its payment steps adds the missing steps;
    // a contribution or another person assigned in the preview stays as it is
    if (
      !entry.payment ||
      order.paymentRecord?.operation ||
      (order.paymentRecord && order.paymentRecord.assignment.person.id !== 'per_PreviewWeber')
    )
      continue;
    const snapshot = {
      personId: 'per_PreviewWeber',
      amount: order.totalCents!,
      description: `Sammelbestellung Herbst (Test) · Bestellung ${order.id}`,
      orderId: order.id,
      campaignId: entry.campaign,
      revision: previewDigest({ items: order.items, name: order.name, email: order.email }),
      attachedExpense: {
        costunitName: 'Sammelbestellung Herbst (Test)',
        categoryName: 'Bestellungen',
      },
    };
    const record: SammelPaymentRecord = {
      version: 1,
      assignment: {
        person: {
          id: 'per_PreviewWeber',
          name: 'Wiebke Weber',
          emails: [entry.email],
          matchesEmail: true,
        },
        reason: '',
        confirmedBy: actor,
        confirmedAt: at(-2),
      },
      operation: {
        key: '00000000-0000-4000-8000-0000000001aa',
        hash: previewDigest(snapshot),
        snapshot,
        state: 'created',
        startedAt: at(-1),
        attemptedAt: at(-1),
        contribution: { id: 'fee_PreviewWeber', reference: 'GC-TEST-0001' },
        errorCategory: null,
      },
      dispatch: null,
      settlement: null,
    };
    const steps: [SammelPaymentEvent['action'], string][] = [
      ['assigned', ''],
      ['adopted', 'Erfundener Testbeitrag der Preview, nicht in CampFlow.'],
    ];
    for (const [action, evidence] of steps) {
      if (action === 'assigned' && order.paymentRecord) continue;
      await updateSammelOrder(
        order.id,
        {
          payment: {
            record: action === 'assigned' ? { ...record, operation: null } : record,
            event: {
              at: at(-1),
              actor,
              action,
              operationKey: action === 'assigned' ? null : record.operation!.key,
              evidence,
            },
          },
        },
        order.etag
      );
      order = (await getSammelOrder(order.id))!;
    }
  }

  const db = getDb();
  const archivedNumber = Number(archivedId);
  const invited = await db
    .selectFrom('sammel.invitation')
    .select('address')
    .where('campaign_id', '=', archivedNumber)
    .executeTakeFirst();
  if (!invited)
    await db
      .insertInto('sammel.invitation')
      .values(
        [
          'familie.mueller@example.test',
          'familie.weber@example.test',
          'eltern.test@example.test',
        ].map((address) => ({ campaign_id: archivedNumber, address, status: 'sent' as const }))
      )
      .execute();
  const quota = await db
    .selectFrom('sammel.link_quota')
    .select('campaign_id')
    .where('campaign_id', '=', Number(openId))
    .executeTakeFirst();
  if (!quota)
    await db
      .insertInto('sammel.link_quota')
      .values({
        campaign_id: Number(openId),
        hour_window: Math.floor(now.getTime() / 3_600_000),
        hour_count: 1,
        day_window: Math.floor(now.getTime() / day),
        day_count: 5,
      })
      .execute();
}

/** The option IDs of an Abstimmung in their order. */
async function previewOptionen(id: number): Promise<number[]> {
  const rows = await getDb()
    .selectFrom('abstimmung.optionen')
    .select('id')
    .where('abstimmung_id', '=', id)
    .orderBy('position')
    .execute();
  return rows.map((option) => option.id);
}

/**
 * Two invented Abstimmungen with a few answers and an invitation, so every table and setting
 * of the Abstimmungen has rows: an open Terminfindung with „Vielleicht“ and a question whose
 * answers only the organizer sees. Created by an invented leader: real logins of the preview see
 * them as participants and create their own to manage. Each one is skipped if it exists already.
 */
export async function seedPreviewAbstimmungen(): Promise<void> {
  const db = getDb();
  const organisator = { login: 'vorschau@example.test', name: 'Vroni Vorschau', adressen: [] };
  const theo = { login: 'theo.test@example.test', name: 'Theo Test', adressen: [] };
  const vorhanden = async (titel: string): Promise<boolean> =>
    Boolean(
      await db
        .selectFrom('abstimmung.abstimmung')
        .select('id')
        .where('titel', '=', titel)
        .executeTakeFirst()
    );

  const termin = 'Termin für die Weihnachtsfeier (Test)';
  if (!(await vorhanden(termin))) {
    const id = await createAbstimmung(
      validateAbstimmung({
        titel: termin,
        beschreibung: 'Erfundene Testdaten der Preview. Bitte alle Termine wählen, die gehen.',
        vielleichtErlaubt: true,
        optionen: [
          { text: 'Fr, 11.12. ab 19 Uhr' },
          { text: 'Sa, 12.12. ab 18 Uhr' },
          { text: 'Fr, 18.12. ab 19 Uhr' },
        ],
      }),
      organisator
    );
    const [erste, zweite, dritte] = await previewOptionen(id);
    await voteAsStaff(
      id,
      { ...organisator, adressen: [organisator.login] },
      { gewaehlt: [erste, dritte] }
    );
    await voteAsStaff(id, theo, { gewaehlt: [zweite], vielleicht: [dritte] });
    await queueAbstimmungEinladungen(id, organisator.login, [
      { email: 'alt.leitung@example.test', name: 'Alma Altleitung', familie: false },
    ]);
    // Sent without a mail: the preview never mails invented addresses
    await db
      .updateTable('abstimmung.teilnahme')
      .set({ mail_status: 'gesendet', eingeladen_am: new Date().toISOString() })
      .where('abstimmung_id', '=', id)
      .where('mail_status', '=', 'offen')
      .execute();
  }

  const ziel = 'Ziel für das Leitendenwochenende (Test)';
  if (!(await vorhanden(ziel))) {
    const id = await createAbstimmung(
      validateAbstimmung({
        titel: ziel,
        beschreibung: 'Erfundene Testdaten der Preview. Höchstens zwei Ziele wählen.',
        maxAuswahl: 2,
        sichtbarkeit: 'anonym',
        optionen: [
          { text: 'Zeltplatz am See' },
          { text: 'Hütte in den Bergen' },
          { text: 'Stadt' },
        ],
      }),
      organisator
    );
    const [see, huette] = await previewOptionen(id);
    await voteAsStaff(id, theo, { gewaehlt: [see, huette] });
  }
}

/** Invented entries in the log of the Essensplanung-Steuerung; the settings stay as migrated. */
export async function seedPreviewEssensplanung(): Promise<void> {
  const db = getDb();
  const vorhanden = await db.selectFrom('essen.audit_log').select('id').top(1).executeTakeFirst();
  if (vorhanden) return;
  await db
    .insertInto('essen.audit_log')
    .values([
      {
        actor: 'Vroni Vorschau',
        action: 'zutat-geaendert',
        details: JSON.stringify({ id: 0, name: 'Honig (Test)' }),
      },
      {
        actor: 'Theo Test',
        action: 'kategorie-umbenannt',
        details: JSON.stringify({ id: 0, name: 'Backwaren (Test)', vorher: 'Backware' }),
      },
    ])
    .execute();
}
