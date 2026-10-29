import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import { CONFIG } from './config';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  lockResource,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type { Db } from './db';
import type { EditorSperreTable } from './db-schema';
import { dateToLocalParts } from './nikolaus-config';
import type {
  OffeneAufgabeQuelle,
  ProtokollEditorDetail,
  ProtokollEditorOverview,
  ProtokollInhalt,
  ProtokollKopf,
  ProtokollLiveResponse,
  ProtokollRevision,
  ProtokollRevisionListItem,
  ProtokollRevisionReason,
  ProtokollSaveResponse,
  ProtokollSperre,
  Vorbelegung,
} from './protokoll-editor-model';
import { SPERRE_SECONDS, neuerInhalt, offeneAufgabenPunkt } from './protokoll-editor-model';
import type {
  ProtokollEditorCreateInput,
  ProtokollEditorSaveInput,
  ProtokollSperreInput,
} from './validation/protokoll-editor';
import { ValidationError } from './validation/errors';
import { validateProtokollInhalt } from './validation/protokoll-inhalt';

/**
 * Minutes written on the website (#277, `docs/protokoll-editor.md`). One tab writes and holds
 * the lock, everyone else reads along. Every save is checked against the loaded version and
 * the lock; revisions keep earlier versions, so nothing typed is ever lost.
 */

/** Minutes between the revisions kept while saving. */
export const REVISION_MINUTES = 5;

/** Who acts: login and the name shown to the others. */
export interface EditorPerson {
  login: string;
  name: string;
}

/** Another tab holds the lock; carries it so the page can say who writes. */
export class SperreError extends Error {
  readonly statusCode = 423;

  constructor(public sperre: ProtokollSperre) {
    super(`Das Protokoll wird gerade von ${sperre.name} geschrieben.`);
    this.name = 'SperreError';
  }
}

/** Only drafts can be written; the later states belong to review and mailing. */
export class NotEditableError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('Das Protokoll ist nicht mehr im Entwurf und kann nicht mehr bearbeitet werden.');
    this.name = 'NotEditableError';
  }
}

/** The application lock that serializes all writes to one set of minutes. */
export function editorResource(id: number): string {
  return `protokoll-editor:${id}`;
}

export function sameLogin(a: string, b: string): boolean {
  return a !== '' && a.toLowerCase() === b.toLowerCase();
}

export function toSperre(
  row: Selectable<EditorSperreTable>,
  token: string | null,
  now: Date
): ProtokollSperre {
  return {
    login: row.login,
    name: row.name,
    since: row.since.toISOString(),
    until: row.until.toISOString(),
    aktiverPunkt: row.aktiver_punkt,
    mine: token !== null && row.token === token,
    expired: row.until.getTime() <= now.getTime(),
  };
}

/**
 * Reads stored content. A document that no longer passes the checks fails loudly instead of
 * being replaced, so the editor never saves an empty version over it.
 */
export function parseInhalt(content: string): ProtokollInhalt {
  return validateProtokollInhalt(JSON.parse(content));
}

export async function readSperre(
  db: Db,
  id: number
): Promise<Selectable<EditorSperreTable> | undefined> {
  return db
    .selectFrom('protokoll.sperre')
    .selectAll()
    .where('protokoll_id', '=', id)
    .executeTakeFirst();
}

export async function getEditorOverview(now: Date = new Date()): Promise<ProtokollEditorOverview> {
  const rows = await getDb()
    .selectFrom('protokoll.protokoll as p')
    .leftJoin('protokoll.sperre as s', 's.protokoll_id', 'p.id')
    .select([
      'p.id',
      'p.title',
      'p.meeting_date',
      'p.status',
      'p.created_by',
      'p.updated_at',
      's.name as writer',
      's.until as writer_until',
    ])
    .orderBy('p.meeting_date', 'desc')
    .orderBy('p.id', 'desc')
    .execute();
  return {
    protokolle: rows.map((row) => ({
      id: row.id,
      title: row.title,
      date: toDateString(row.meeting_date),
      status: row.status,
      createdBy: row.created_by,
      updatedAt: row.updated_at.toISOString(),
      writer:
        row.writer && row.writer_until && row.writer_until.getTime() > now.getTime()
          ? row.writer
          : null,
    })),
    today: dateToLocalParts(now).date,
    defaultTitle: CONFIG.protokolle.defaultTitle,
  };
}

/** The lock of the minutes, read along with them (`p` joined with `s`). */
const SPERRE_COLUMNS = [
  's.login as sperre_login',
  's.name as sperre_name',
  's.token as sperre_token',
  's.since as sperre_since',
  's.until as sperre_until',
  's.aktiver_punkt as sperre_aktiver_punkt',
] as const;

interface JoinedSperre {
  sperre_login: string | null;
  sperre_name: string | null;
  sperre_token: string | null;
  sperre_since: Date | null;
  sperre_until: Date | null;
  sperre_aktiver_punkt: string | null;
}

function joinedSperre(
  row: JoinedSperre,
  id: number,
  token: string | null,
  now: Date
): ProtokollSperre | null {
  if (row.sperre_login === null || row.sperre_since === null || row.sperre_until === null) {
    return null;
  }
  return toSperre(
    {
      protokoll_id: id,
      login: row.sperre_login,
      name: row.sperre_name ?? '',
      token: row.sperre_token ?? '',
      since: row.sperre_since,
      until: row.sperre_until,
      aktiver_punkt: row.sperre_aktiver_punkt,
    },
    token,
    now
  );
}

/** The minutes as the editor and the readers see them; `undefined` if they do not exist. */
export async function getEditorProtokoll(
  id: number,
  token: string | null,
  now: Date = new Date()
): Promise<ProtokollEditorDetail | undefined> {
  // One statement: the minutes with their lock and the tasks their approval created
  const row = await getDb()
    .selectFrom('protokoll.protokoll as p')
    .leftJoin('protokoll.sperre as s', 's.protokoll_id', 'p.id')
    .selectAll('p')
    .select(SPERRE_COLUMNS)
    .select((eb) =>
      eb
        .selectFrom('organisation.task as t')
        .select(eb.fn.countAll<number>().as('count'))
        .whereRef('t.protokoll_id', '=', 'p.id')
        .as('aufgaben')
    )
    .where('p.id', '=', id)
    .executeTakeFirst();
  if (!row) return undefined;
  const approved = row.status === 'freigegeben' || row.status === 'verschickt';
  return {
    id: row.id,
    title: row.title,
    date: toDateString(row.meeting_date),
    status: row.status,
    inhalt: parseInhalt(row.content),
    etag: toVersion(row.version),
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
    sperre: joinedSperre(row, id, token, now),
    canDelete: row.status === 'entwurf',
    submittedBy: row.submitted_by ?? '',
    submittedAt: row.submitted_at?.toISOString() ?? '',
    reviewNote: row.review_note ?? '',
    approvedBy: row.approved_by ?? '',
    approvedAt: row.approved_at?.toISOString() ?? '',
    ablage:
      row.pdf_item_id && row.pdf_name
        ? { fileName: row.pdf_name, webUrl: row.pdf_url ?? '' }
        : null,
    versand: row.delivery_state
      ? {
          state: row.delivery_state,
          recipients: row.delivery_recipients ?? 0,
          at: row.delivery_at?.toISOString() ?? '',
          by: row.delivery_by ?? '',
        }
      : null,
    sendingConfigured: CONFIG.protokolle.sender !== '',
    aufgabenAngelegt: approved ? Number(row.aufgaben ?? 0) : 0,
  };
}

/**
 * The live check of the readers: who writes, and the full minutes only if their version is no
 * longer `etag`, so an unchanged check stays one small statement.
 */
export async function getEditorLive(
  id: number,
  etag: string,
  token: string | null,
  now: Date = new Date()
): Promise<ProtokollLiveResponse | undefined> {
  const row = await getDb()
    .selectFrom('protokoll.protokoll as p')
    .leftJoin('protokoll.sperre as s', 's.protokoll_id', 'p.id')
    .select('p.version')
    .select(SPERRE_COLUMNS)
    .where('p.id', '=', id)
    .executeTakeFirst();
  if (!row) return undefined;
  const current = toVersion(row.version);
  if (current !== etag) {
    const protokoll = await getEditorProtokoll(id, token, now);
    if (!protokoll) return undefined;
    return { etag: protokoll.etag, sperre: protokoll.sperre, protokoll };
  }
  return { etag: current, sperre: joinedSperre(row, id, token, now), protokoll: null };
}

/**
 * New minutes with the standard agenda, after the item „Offene Aufgaben“ with the open tasks
 * from earlier minutes (if there are any) and prefilled from other modules; returns the ID.
 */
export async function createEditorProtokoll(
  input: ProtokollEditorCreateInput,
  kopf: Partial<ProtokollKopf>,
  actor: string,
  offen: OffeneAufgabeQuelle[] = [],
  vorbelegung: Partial<Vorbelegung> = {}
): Promise<number> {
  const nextId = (): string => randomUUID().slice(0, 8);
  const inhalt = neuerInhalt(nextId, kopf, vorbelegung);
  const offenePunkt = offeneAufgabenPunkt(nextId(), offen);
  if (offenePunkt) inhalt.punkte.unshift(offenePunkt);
  const { id } = await getDb()
    .insertInto('protokoll.protokoll')
    .values({
      title: input.title,
      meeting_date: input.date,
      content: JSON.stringify(inhalt),
      created_by: actor,
      updated_by: actor,
    })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  return id;
}

async function addRevision(
  db: Db,
  protokoll: { id: number; title: string; meeting_date: Date | string; content: string },
  reason: ProtokollRevisionReason,
  actor: string,
  now: Date
): Promise<void> {
  await db
    .insertInto('protokoll.revision')
    .values({
      protokoll_id: protokoll.id,
      title: protokoll.title,
      meeting_date: toDateString(protokoll.meeting_date),
      content: protokoll.content,
      reason,
      saved_at: now,
      saved_by: actor,
    })
    .execute();
}

/**
 * Takes the lock for the tab with `token` and writes it with the given expiry. Throws while
 * another tab holds a lock that has not run out, unless `uebernehmen`. Taking the lock from
 * another tab first keeps the stored version as a revision.
 */
async function claimSperre(
  db: Db,
  protokoll: { id: number; title: string; meeting_date: Date | string; content: string },
  input: ProtokollSperreInput,
  person: EditorPerson,
  now: Date
): Promise<ProtokollSperre> {
  const current = await readSperre(db, protokoll.id);
  const foreign = current !== undefined && current.token !== input.token;
  if (foreign && !input.uebernehmen && current.until.getTime() > now.getTime()) {
    throw new SperreError(toSperre(current, input.token, now));
  }
  if (foreign) await addRevision(db, protokoll, 'uebernahme', person.login, now);
  const values = {
    login: person.login,
    name: person.name,
    token: input.token,
    since: foreign || !current ? now : current.since,
    until: new Date(now.getTime() + SPERRE_SECONDS * 1000),
    aktiver_punkt: input.aktiverPunkt,
  };
  if (current) {
    await db
      .updateTable('protokoll.sperre')
      .set(values)
      .where('protokoll_id', '=', protokoll.id)
      .execute();
  } else {
    await db
      .insertInto('protokoll.sperre')
      .values({ protokoll_id: protokoll.id, ...values })
      .execute();
  }
  return toSperre({ protokoll_id: protokoll.id, ...values }, input.token, now);
}

async function lockedProtokoll(db: Db, id: number) {
  const row = await db
    .selectFrom('protokoll.protokoll')
    .select(['id', 'title', 'meeting_date', 'content', 'status', 'version', 'updated_at'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new RecordNotFoundError();
  return row;
}

/** Takes or renews the lock of the tab with `token`. */
export async function takeSperre(
  id: number,
  input: ProtokollSperreInput,
  person: EditorPerson,
  now: Date = new Date()
): Promise<ProtokollSaveResponse> {
  return inTransaction(async (trx) => {
    await lockResource(trx, editorResource(id));
    const row = await lockedProtokoll(trx, id);
    if (row.status !== 'entwurf') throw new NotEditableError();
    const sperre = await claimSperre(trx, row, input, person, now);
    return { etag: toVersion(row.version), updatedAt: row.updated_at.toISOString(), sperre };
  });
}

/** Gives the lock up, if this tab still holds it. */
export async function releaseSperre(id: number, token: string): Promise<void> {
  await getDb()
    .deleteFrom('protokoll.sperre')
    .where('protokoll_id', '=', id)
    .where('token', '=', token)
    .execute();
}

/**
 * Saves the whole document against the version it was based on. The tab must hold the lock or
 * take a free or expired one; the save renews it. At most every `REVISION_MINUTES` the saved
 * version is also kept as a revision; with `sicherung` the stored version is kept before it
 * is replaced.
 */
export async function saveEditorProtokoll(
  id: number,
  input: ProtokollEditorSaveInput,
  person: EditorPerson,
  now: Date = new Date()
): Promise<ProtokollSaveResponse> {
  const version = requireVersion(input.etag);
  return inTransaction(async (trx) => {
    await lockResource(trx, editorResource(id));
    const row = await lockedProtokoll(trx, id);
    if (row.status !== 'entwurf') throw new NotEditableError();
    // An outdated save never touches the lock or the revisions
    if (!row.version.equals(version)) throw new VersionConflictError();
    // A save never takes the lock from a tab that still holds it
    const sperre = await claimSperre(trx, row, { ...input, uebernehmen: false }, person, now);
    if (input.sicherung) await addRevision(trx, row, input.sicherung, person.login, now);

    const content = JSON.stringify(input.inhalt);
    const updated = await trx
      .updateTable('protokoll.protokoll')
      .set({
        title: input.title,
        meeting_date: input.date,
        content,
        updated_by: person.login,
        updated_at: sql<Date>`SYSUTCDATETIME()`,
      })
      .where('id', '=', id)
      .output(['inserted.version', 'inserted.updated_at'])
      .executeTakeFirstOrThrow();

    const last = await trx
      .selectFrom('protokoll.revision')
      .select('saved_at')
      .where('protokoll_id', '=', id)
      .where('reason', '=', 'speichern')
      .orderBy('saved_at', 'desc')
      .top(1)
      .executeTakeFirst();
    if (!last || now.getTime() - last.saved_at.getTime() >= REVISION_MINUTES * 60_000) {
      await addRevision(
        trx,
        { id, title: input.title, meeting_date: input.date, content },
        'speichern',
        person.login,
        now
      );
    }
    return {
      etag: toVersion(updated.version),
      updatedAt: updated.updated_at.toISOString(),
      sperre,
    };
  });
}

export async function listRevisions(id: number): Promise<ProtokollRevisionListItem[]> {
  const rows = await getDb()
    .selectFrom('protokoll.revision')
    .select(['id', 'saved_at', 'saved_by', 'reason'])
    .where('protokoll_id', '=', id)
    .orderBy('saved_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    savedAt: row.saved_at.toISOString(),
    savedBy: row.saved_by,
    reason: row.reason,
  }));
}

export async function getRevision(
  id: number,
  revisionId: number
): Promise<ProtokollRevision | undefined> {
  const row = await getDb()
    .selectFrom('protokoll.revision')
    .selectAll()
    .where('protokoll_id', '=', id)
    .where('id', '=', revisionId)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    id: row.id,
    savedAt: row.saved_at.toISOString(),
    savedBy: row.saved_by,
    reason: row.reason,
    title: row.title,
    date: toDateString(row.meeting_date),
    inhalt: parseInhalt(row.content),
  };
}

/** Deletes a draft with its revisions. Returns false if it did not exist. */
export async function deleteEditorProtokoll(id: number): Promise<boolean> {
  return inTransaction(async (trx) => {
    await lockResource(trx, editorResource(id));
    const row = await trx
      .selectFrom('protokoll.protokoll')
      .select('status')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return false;
    if (row.status !== 'entwurf') {
      throw new ValidationError({ form: 'Nur Entwürfe können gelöscht werden.' });
    }
    await trx.deleteFrom('protokoll.protokoll').where('id', '=', id).execute();
    return true;
  });
}

/**
 * IDs of the PDFs filed by the editor in a library. The list of protocol files leaves them
 * out: they belong to minutes of the editor and are handled there.
 */
export async function editorAblageItemIds(driveId: string): Promise<Set<string>> {
  const rows = await getDb()
    .selectFrom('protokoll.protokoll')
    .select('pdf_item_id')
    .where('pdf_drive_id', '=', driveId)
    .where('pdf_item_id', 'is not', null)
    .execute();
  return new Set(rows.flatMap((row) => (row.pdf_item_id ? [row.pdf_item_id] : [])));
}
