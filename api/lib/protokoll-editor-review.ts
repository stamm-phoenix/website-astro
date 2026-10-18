import { randomUUID } from 'node:crypto';
import { CONFIG } from './config';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  lockResource,
  requireVersion,
  toDateString,
} from './db';
import { getLeitende } from './leitende-list';
import { ValidationError } from './pflege-validation';
import { SperreError, editorResource, parseInhalt, readSperre, toSperre } from './protokoll-editor';
import type { PdfVorstand } from './protokoll-editor-pdf';
import { createProtokollPdf, protokollPdfFileName } from './protokoll-editor-pdf';
import { createProtokollTasks } from './protokoll-editor-aufgaben';
import type { ProtokollFreigabeResponse } from './protokoll-editor-model';
import { findDrive } from './protokoll-source';
import { assertOwnApprovalConfirmed } from './protokolle';
import {
  createSharePointDriveFile,
  deleteSharePointDriveItem,
  getGraphStatus,
  getSharePointDriveFileContent,
} from './sharepoint-data-access';
import type { ClientPrincipal } from './staff-auth';

/**
 * Review, approval and mailing of minutes written in the editor (#277, step 2,
 * `docs/protokoll-editor.md`): Entwurf → (Review →) Freigegeben → Verschickt, like the Word
 * minutes (`protokolle.ts`), but the state lives in `protokoll.protokoll`. Every leader may
 * review; the review is optional, so a draft can be approved directly. The approval creates the
 * PDF and files it in the folder of the minutes; after that the minutes no longer change.
 */

/** The library of the minutes is missing, so the PDF cannot be filed. */
export class AblageNotConfiguredError extends Error {
  readonly statusCode = 503;

  constructor() {
    super(`Die Bibliothek „${CONFIG.protokolle.library}“ wurde in SharePoint nicht gefunden.`);
    this.name = 'AblageNotConfiguredError';
  }
}

/** An earlier mailing was started but not confirmed; resending needs a deliberate retry. */
export class VersandUncertainError extends Error {
  readonly statusCode = 409;

  constructor() {
    super(
      'Der letzte Versand wurde gestartet, aber nicht bestätigt. Bitte im Postfach des Absenders prüfen, ob die Mail rausging, bevor du erneut sendest.'
    );
    this.name = 'VersandUncertainError';
  }
}

/** File names tried for the PDF before giving up; later ones get „(2)“, „(3)“ … */
const MAX_NAME_ATTEMPTS = 10;
const MAX_NOTE = 2000;

function deny(message: string): never {
  throw new ValidationError({ form: message });
}

async function loadRow(id: number) {
  const row = await getDb()
    .selectFrom('protokoll.protokoll')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new RecordNotFoundError();
  return row;
}

/**
 * Gives a draft to the review. Saving stops: the lock is released, and a tab still writing
 * gets „not editable“. Only the tab holding the lock, or anyone while nobody writes, may do it,
 * so nothing typed elsewhere is cut off.
 */
export async function submitEditorReview(
  id: number,
  input: { etag: string | undefined; token: string | null },
  actor: string,
  now: Date = new Date()
): Promise<void> {
  const version = requireVersion(input.etag);
  await inTransaction(async (trx) => {
    await lockResource(trx, editorResource(id));
    const row = await trx
      .selectFrom('protokoll.protokoll')
      .select(['status', 'version'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new RecordNotFoundError();
    if (row.status !== 'entwurf') deny('Nur Entwürfe können zum Review gegeben werden.');
    if (!row.version.equals(version)) throw new VersionConflictError();
    const sperre = await readSperre(trx, id);
    if (sperre && sperre.token !== input.token && sperre.until.getTime() > now.getTime()) {
      throw new SperreError(toSperre(sperre, input.token, now));
    }
    await trx.deleteFrom('protokoll.sperre').where('protokoll_id', '=', id).execute();
    await trx
      .updateTable('protokoll.protokoll')
      .set({ status: 'review', submitted_at: now, submitted_by: actor, review_note: null })
      .where('id', '=', id)
      .execute();
  });
}

/**
 * Sends minutes in review back to the draft with a note for the author. Returns what the mail
 * to the author needs.
 */
export async function rejectEditorReview(
  id: number,
  input: { etag: string | undefined; note: string }
): Promise<{ createdBy: string; title: string; date: string }> {
  const note = input.note.trim();
  if (!note) throw new ValidationError({ note: 'Bitte kurz schreiben, was noch fehlt.' });
  if (note.length > MAX_NOTE) {
    throw new ValidationError({ note: `Bitte höchstens ${MAX_NOTE} Zeichen.` });
  }
  const version = requireVersion(input.etag);
  return inTransaction(async (trx) => {
    await lockResource(trx, editorResource(id));
    const row = await trx
      .selectFrom('protokoll.protokoll')
      .select(['status', 'version', 'created_by', 'title', 'meeting_date'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new RecordNotFoundError();
    if (row.status !== 'review') deny('Nur Protokolle im Review können zurückgehen.');
    if (!row.version.equals(version)) throw new VersionConflictError();
    await trx
      .updateTable('protokoll.protokoll')
      .set({ status: 'entwurf', review_note: note })
      .where('id', '=', id)
      .execute();
    return {
      createdBy: row.created_by,
      title: row.title,
      date: toDateString(row.meeting_date),
    };
  });
}

/** The Vorstand for the letterhead; empty if the list of leaders cannot be read. */
export async function loadPdfVorstaende(): Promise<PdfVorstand[]> {
  try {
    const leitende = await getLeitende();
    return leitende
      .filter((person) => person.teams.includes('Vorstand'))
      .map((person) => ({
        name: person.name,
        telephone: person.telephone,
        street: person.street,
        city: person.city,
      }));
  } catch {
    return [];
  }
}

interface FiledPdf {
  id: string;
  name: string;
  webUrl: string;
}

/** Uploads the PDF; if the name is taken, the next free „Titel (2).pdf“. */
async function filePdf(
  driveId: string,
  date: string,
  title: string,
  pdf: Uint8Array
): Promise<FiledPdf> {
  const base = protokollPdfFileName(date, title);
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const name = attempt === 1 ? base : base.replace(/\.pdf$/, ` (${attempt}).pdf`);
    try {
      const created = (await createSharePointDriveFile(
        driveId,
        CONFIG.protokolle.folderPath,
        name,
        pdf
      )) as { id?: unknown; name?: unknown; webUrl?: unknown };
      if (typeof created?.id !== 'string') throw new Error('SharePoint returned no item ID.');
      return {
        id: created.id,
        name: typeof created.name === 'string' ? created.name : name,
        webUrl: typeof created.webUrl === 'string' ? created.webUrl : '',
      };
    } catch (error: unknown) {
      if (getGraphStatus(error) !== 409) throw error;
    }
  }
  deny('Im Protokoll-Ordner gibt es schon zu viele Dateien mit diesem Namen.');
}

/**
 * Approves a draft or minutes in review: creates the PDF with the approval, files it in the
 * folder of the minutes and then marks the minutes as approved and creates their tasks in the
 * module Aufgaben, in one transaction. If the minutes changed in the meantime, the filed PDF is
 * removed again. A draft, like giving it to the review, only from
 * the tab holding the lock or while nobody writes. Approving one's own minutes needs
 * `ownConfirmed`.
 */
export async function approveEditorProtokoll(
  id: number,
  input: { etag: string | undefined; token: string | null; ownConfirmed: boolean },
  principal: ClientPrincipal,
  now: Date = new Date()
): Promise<ProtokollFreigabeResponse> {
  const version = requireVersion(input.etag);
  const row = await loadRow(id);
  if (row.status !== 'entwurf' && row.status !== 'review') {
    deny('Nur Entwürfe und Protokolle im Review können freigegeben werden.');
  }
  if (!row.version.equals(version)) throw new VersionConflictError();
  assertOwnApprovalConfirmed(row.created_by, principal, input.ownConfirmed);
  /** Someone else still writes: their unsaved text must not be cut off. */
  const assertNotWritten = async (sperre: Awaited<ReturnType<typeof readSperre>>) => {
    if (sperre && sperre.token !== input.token && sperre.until.getTime() > now.getTime()) {
      throw new SperreError(toSperre(sperre, input.token, now));
    }
  };
  if (row.status === 'entwurf') await assertNotWritten(await readSperre(getDb(), id));

  const date = toDateString(row.meeting_date);
  const inhalt = parseInhalt(row.content);
  const pdf = await createProtokollPdf({
    title: row.title,
    date,
    inhalt,
    vorstaende: await loadPdfVorstaende(),
    freigabe: { by: principal.userDetails, at: now },
  });
  const driveId = await findDrive();
  if (!driveId) throw new AblageNotConfiguredError();
  const filed = await filePdf(driveId, date, row.title, pdf);

  let aufgaben: number;
  try {
    aufgaben = await inTransaction(async (trx) => {
      await lockResource(trx, editorResource(id));
      const current = await trx
        .selectFrom('protokoll.protokoll')
        .select(['status', 'version'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!current) throw new RecordNotFoundError();
      if (current.status !== row.status || !current.version.equals(version)) {
        throw new VersionConflictError();
      }
      if (current.status === 'entwurf') {
        await assertNotWritten(await readSperre(trx, id));
        await trx.deleteFrom('protokoll.sperre').where('protokoll_id', '=', id).execute();
      }
      await trx
        .updateTable('protokoll.protokoll')
        .set({
          status: 'freigegeben',
          review_note: null,
          approved_at: now,
          approved_by: principal.userDetails,
          pdf_drive_id: driveId,
          pdf_item_id: filed.id,
          pdf_name: filed.name,
          pdf_url: filed.webUrl,
        })
        .where('id', '=', id)
        .execute();
      // The version is unchanged, so these are the tasks of the approved minutes
      return createProtokollTasks(trx, id, inhalt, principal.userDetails);
    });
  } catch (error: unknown) {
    // Someone else was faster or the minutes changed; their PDF must not stay twice
    await deleteSharePointDriveItem(driveId, filed.id).catch(() => undefined);
    throw error;
  }
  return { fileName: filed.name, aufgaben };
}

/**
 * The PDF of the minutes: the filed one once approved, otherwise a fresh one marked as draft.
 * A filed PDF that went missing in SharePoint is created again with its approval.
 */
export async function editorProtokollPdf(
  id: number
): Promise<{ fileName: string; content: Uint8Array }> {
  const row = await loadRow(id);
  const date = toDateString(row.meeting_date);
  if (row.pdf_drive_id && row.pdf_item_id) {
    try {
      return {
        fileName: row.pdf_name ?? protokollPdfFileName(date, row.title),
        content: await getSharePointDriveFileContent(row.pdf_drive_id, row.pdf_item_id),
      };
    } catch (error: unknown) {
      if (getGraphStatus(error) !== 404) throw error;
    }
  }
  const content = await createProtokollPdf({
    title: row.title,
    date,
    inhalt: parseInhalt(row.content),
    vorstaende: await loadPdfVorstaende(),
    freigabe:
      row.approved_by && row.approved_at ? { by: row.approved_by, at: row.approved_at } : null,
  });
  return { fileName: protokollPdfFileName(date, row.title), content };
}

/** What the mailing needs of approved minutes. */
export interface VersandQuelle {
  title: string;
  date: string;
  approvedBy: string;
  pdf: { driveId: string; itemId: string; fileName: string };
}

/**
 * Checks that the minutes can be mailed: approved, not sent yet, and without an unconfirmed
 * earlier attempt unless `retry`.
 */
export async function loadEditorVersand(id: number, retry: boolean): Promise<VersandQuelle> {
  const row = await loadRow(id);
  if (row.status === 'verschickt') deny('Das Protokoll wurde schon verschickt.');
  if (row.status !== 'freigegeben') deny('Nur freigegebene Protokolle können verschickt werden.');
  if (row.delivery_state === 'attempted' && !retry) throw new VersandUncertainError();
  if (!row.pdf_drive_id || !row.pdf_item_id) deny('Das PDF des Protokolls fehlt.');
  const date = toDateString(row.meeting_date);
  return {
    title: row.title,
    date,
    approvedBy: row.approved_by ?? '',
    pdf: {
      driveId: row.pdf_drive_id,
      itemId: row.pdf_item_id,
      fileName: row.pdf_name ?? protokollPdfFileName(date, row.title),
    },
  };
}

/**
 * Reserves the mailing before the mail goes out: the etag stops a second tab or person from
 * sending the same minutes. Returns the ID of this attempt.
 */
export async function reserveEditorVersand(
  id: number,
  input: { etag: string | undefined; retry: boolean; recipients: number },
  actor: string,
  now: Date = new Date()
): Promise<string> {
  const version = requireVersion(input.etag);
  return inTransaction(async (trx) => {
    await lockResource(trx, editorResource(id));
    const row = await trx
      .selectFrom('protokoll.protokoll')
      .select(['status', 'version', 'delivery_state'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new RecordNotFoundError();
    if (!row.version.equals(version)) throw new VersionConflictError();
    if (row.status !== 'freigegeben') {
      deny('Nur freigegebene Protokolle können verschickt werden.');
    }
    if (row.delivery_state === 'attempted' && !input.retry) throw new VersandUncertainError();
    const attempt = randomUUID();
    await trx
      .updateTable('protokoll.protokoll')
      .set({
        delivery_state: 'attempted',
        delivery_attempt: attempt,
        delivery_recipients: input.recipients,
        delivery_at: now,
        delivery_by: actor,
      })
      .where('id', '=', id)
      .execute();
    return attempt;
  });
}

/**
 * Completes exactly this attempt: `sent` marks the minutes as sent, `failed` (the mail was
 * refused for sure) clears the reservation. Another or finished attempt is left alone.
 */
export async function finishEditorVersand(
  id: number,
  attempt: string,
  outcome: 'sent' | 'failed',
  now: Date = new Date()
): Promise<void> {
  await inTransaction(async (trx) => {
    await lockResource(trx, editorResource(id));
    const row = await trx
      .selectFrom('protokoll.protokoll')
      .select(['delivery_state', 'delivery_attempt'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row || row.delivery_state !== 'attempted' || row.delivery_attempt !== attempt) {
      throw new VersionConflictError();
    }
    await trx
      .updateTable('protokoll.protokoll')
      .set(
        outcome === 'sent'
          ? { status: 'verschickt', delivery_state: 'sent', delivery_at: now }
          : {
              delivery_state: null,
              delivery_attempt: null,
              delivery_recipients: null,
              delivery_at: null,
              delivery_by: null,
            }
      )
      .where('id', '=', id)
      .execute();
  });
}
