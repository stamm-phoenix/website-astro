import type { HttpResponseInit } from '@azure/functions';
import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type { BelegCampflow, StoredBeleg } from './beleg-list';
import {
  deleteBeleg,
  downloadFileName,
  getBeleg,
  getBelegCampflowRow,
  toBelegCampflow,
} from './beleg-list';
import { readBelegPhoto } from './beleg-photos';
import type { BelegCampflowTable } from './db-schema';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  getSqlErrorNumber,
  requireVersion,
} from './db';
import { PREVIEW_DATABASE } from './deployment';
import { EnvironmentVariable, getEnvironment } from './environment';
import type { Kostenstelle } from './playwright-api';
import {
  PlaywrightApiError,
  ensureCampflowExpenseAssignment,
  getKostenstellen,
  sameCampflowName,
  uploadCampflowBeleg,
} from './playwright-api';
import { errorResponse } from './response-utils';

/**
 * Transfers an accepted receipt to CampFlow through the Playwright API and deletes it afterwards
 * (issue #166, docs/belege-campflow.md). Every attempt is stored in `organisation.beleg_campflow`
 * before CampFlow is called, its result afterwards:
 *
 * - `Gestartet`: the call is running or its result is unknown (timeout, lost answer). Repeating
 *   it is safe, because the Playwright API looks for a receipt with the same file name first; so
 *   a repeat keeps file name, Kostenstelle and Kategorie of the first attempt.
 * - `Fehlgeschlagen`: the Playwright API answered before writing anything (unknown Kategorie,
 *   archived Kostenstelle, …); the next attempt may pick another Kostenstelle.
 *
 * The receipt is booked on the Kostenstelle and Kategorie it names (`resolveTarget`); whichever
 * of them CampFlow lacks is created before the attempt is stored.
 * - `Hochgeladen`: booked in CampFlow with a number. Only then is the receipt deleted.
 */

/** Answers of the Playwright API that come before anything was written to CampFlow. */
const NOTHING_WRITTEN = new Set([400, 401, 403, 404, 409, 413, 429, 503]);
/**
 * An attempt without a result counts as running this long; longer than a call to the Playwright
 * API may take, so a crashed attempt does not lock the receipt for good.
 */
const RUNNING_MS = 60_000;
/** The Playwright API limits file names to 200 characters and descriptions to 255. */
const MAX_SHOP_IN_FILE_NAME = 80;
const MAX_DESCRIPTION = 255;

export class BelegCampflowError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'BelegCampflowError';
  }

  toResponse(): HttpResponseInit {
    return errorResponse(this.status, this.code, this.message);
  }
}

/** Where a receipt is booked in CampFlow. */
export interface BelegCampflowTarget {
  /** `cun_…` */
  costUnitId: string;
  costUnitName: string;
  /** `cat_…` */
  categoryId: string;
  categoryName: string;
}

export interface BelegCampflowResult {
  campflow: BelegCampflow;
  /** False if CampFlow had the receipt already from an earlier attempt. */
  created: boolean;
  /** False if the receipt was changed meanwhile and stays; it can be deleted by hand. */
  deleted: boolean;
}

/**
 * File name in CampFlow, e.g. `2026-09-30 REWE 12,34 EUR (Website-Beleg 123).jpg` (`.pdf` for a
 * PDF). The ID makes
 * it unique, which the Playwright API needs to recognise a receipt it has uploaded before. A
 * name stored with an attempt is reused for its repeats, also after this rule changes.
 */
export function campflowFileName(
  beleg: StoredBeleg,
  previewDatabase: string | null = PREVIEW_DATABASE
): string {
  const shop = beleg.shop.trim().slice(0, MAX_SHOP_IN_FILE_NAME);
  const name = downloadFileName({ ...beleg, shop }).replace(/\.(jpg|pdf)$/, '');
  const extension = beleg.isPdf ? 'pdf' : 'jpg';
  // Previews number their receipts from 1 like production and may share its CampFlow, so their
  // file names name the preview (`website-pr-416` → `pr-416-7`) to stay apart
  const origin = previewDatabase ? `${previewDatabase.replace(/^website-/, '')}-` : '';
  return `${name} (Website-Beleg ${origin}${beleg.id}).${extension}`;
}

/** „Beschreibung“ in CampFlow: shop and note, shortened to fit. */
export function campflowDescription(beleg: StoredBeleg): string {
  const text = [beleg.shop.trim(), beleg.note.trim()]
    .filter(Boolean)
    .join(' – ')
    .replace(/\s+/g, ' ');
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}

/**
 * „Auslage durch“: whoever gets the money back, also „Sparbuch“; nobody when the Stamm paid or
 * for income.
 */
export function campflowDisburser(beleg: StoredBeleg): string | null {
  return beleg.art !== 'Einnahme' && beleg.payout && beleg.paidBy.trim()
    ? beleg.paidBy.trim()
    : null;
}

/** Sphäre of a Kategorie the transfer creates: like every Kategorie of the Aktionen so far. */
const NEW_CATEGORY_SPHERE = 'purpose';

/**
 * Of the request's time, what upload, booking and storing the result need after the preparation
 * (a transfer takes about 10 to 20 seconds). Finding and creating Kostenstelle and Kategorie get
 * the rest; a preparation that needs longer starts no upload, so the answer comes in time.
 */
const UPLOAD_RESERVE_MS = 25_000;

/**
 * The Kategorien of the KJR the form offers for every Kostenstelle (`STANDARD_KATEGORIEN` in
 * `web/src/lib/belegZuordnung.ts`); one typed in another spelling is created in this one.
 */
const STANDARD_KATEGORIEN = [
  'Fahrtkosten',
  'Verpflegungskosten',
  'Miet- und Übernachtungskosten',
  'Honorare',
  'Arbeits- und Hilfsmittel',
];

const sameName = sameCampflowName;

/** The Kostenstelle and Kategorie of that name, an archived Kostenstelle only if no other has it. */
function findTarget(
  units: Kostenstelle[],
  costUnitName: string,
  categoryName: string
): { unit?: Kostenstelle; category?: { id: string; name: string } } {
  const matches = units.filter((unit) => sameName(unit.name, costUnitName));
  const unit = matches.find((u) => !u.archived) ?? matches[0];
  return { unit, category: unit?.categories.find((c) => sameName(c.name, categoryName)) };
}

/**
 * The Kostenstelle and Kategorie the receipt names, by their IDs in CampFlow. One that does not
 * exist there yet, e.g. typed in or one of the standard Kategorien, is created first; that is
 * safe to repeat, as an existing name is found and not created again.
 */
async function resolveTarget(beleg: StoredBeleg, deadline: number): Promise<BelegCampflowTarget> {
  const costUnitName = beleg.kostenstelle.trim();
  const categoryName =
    STANDARD_KATEGORIEN.find((name) => sameName(name, beleg.kategorie)) ?? beleg.kategorie.trim();
  if (!costUnitName || !categoryName) {
    throw new BelegCampflowError(
      400,
      'NO_TARGET',
      'Bitte zuerst Kostenstelle und Kategorie eintragen.'
    );
  }
  const archived = (name: string): BelegCampflowError =>
    new BelegCampflowError(
      422,
      'KOSTENSTELLE_ARCHIVED',
      `Die Kostenstelle „${name}“ ist in CampFlow archiviert. Bitte trage oben im Beleg eine andere Kostenstelle ein und übertrage ihn dann noch einmal.`
    );
  /** Time left before the upload's reserve. */
  const left = (): number => deadline - UPLOAD_RESERVE_MS - Date.now();
  const slow = (cause?: unknown): BelegCampflowError =>
    new BelegCampflowError(
      503,
      'CAMPFLOW_SLOW',
      'CampFlow hat zu lange gebraucht, um Kostenstelle und Kategorie zu prüfen oder anzulegen. Der Beleg wurde noch nicht übertragen. Bitte übertrage ihn gleich noch einmal; schon Angelegtes wird dabei erkannt.',
      { cause }
    );
  if (left() <= 0) throw slow();
  // One time limit for the whole preparation, whatever the number of calls
  const signal = AbortSignal.timeout(left());
  let found: ReturnType<typeof findTarget>;
  try {
    found = findTarget(await getKostenstellen({ signal }), costUnitName, categoryName);
  } catch (error: unknown) {
    if (!(error instanceof PlaywrightApiError)) throw error;
    if (signal.aborted) throw slow(error);
    throw new BelegCampflowError(
      502,
      'KOSTENSTELLEN_UNAVAILABLE',
      'Die Kostenstellen konnten nicht aus CampFlow geladen werden. Es wurde nichts übertragen.'
    );
  }
  if (found.unit?.archived) throw archived(found.unit.name);
  if (!found.unit || !found.category) {
    try {
      await ensureCampflowExpenseAssignment(costUnitName, categoryName, NEW_CATEGORY_SPHERE, {
        signal,
      });
      // The Playwright API drops its list after an addition, so this reads CampFlow again
      found = findTarget(await getKostenstellen({ signal }), costUnitName, categoryName);
    } catch (error: unknown) {
      if (!(error instanceof PlaywrightApiError)) throw error;
      if (signal.aborted) throw slow(error);
      if (error.status === 409) throw archived(costUnitName);
      throw new BelegCampflowError(
        502,
        'TARGET_NOT_CREATED',
        `„${costUnitName}“ mit der Kategorie „${categoryName}“ konnte in CampFlow nicht angelegt werden. Der Beleg wurde nicht übertragen. Bitte versuche es noch einmal.`,
        { cause: error }
      );
    }
    if (!found.unit || !found.category) {
      throw new BelegCampflowError(
        502,
        'TARGET_NOT_CREATED',
        `„${costUnitName}“ mit der Kategorie „${categoryName}“ ist nach dem Anlegen nicht in CampFlow zu finden. Der Beleg wurde nicht übertragen. Bitte lade die Seite neu und versuche es noch einmal.`
      );
    }
    // Created, but too late for the upload to answer in time; the next attempt finds it
    if (left() <= 0) throw slow();
  }
  return {
    costUnitId: found.unit.id,
    costUnitName: found.unit.name,
    categoryId: found.category.id,
    categoryName: found.category.name,
  };
}

/** The receipt as it goes to CampFlow, kept with the transfer once the receipt is deleted. */
function snapshot(beleg: StoredBeleg) {
  return {
    shop: beleg.shop,
    beleg_date: beleg.date || null,
    amount_cent: beleg.amountCent,
    art: beleg.art,
    paid_by: beleg.paidBy,
    payout: beleg.payout,
    aktion: beleg.aktion,
    note: beleg.note,
    submitted_by: beleg.submittedBy,
    beleg_version: requireVersion(beleg.etag),
  };
}

/**
 * Stores the attempt before CampFlow is called; a concurrent attempt makes it a conflict. After
 * an unclear attempt the details it sent stay: CampFlow may hold them already. Returns the
 * version of the row this attempt wrote, which its result needs to be stored.
 */
async function startAttempt(
  beleg: StoredBeleg,
  choice: BelegCampflowTarget,
  fileName: string,
  previous: Selectable<BelegCampflowTable> | undefined,
  actor: string
): Promise<Buffer> {
  const attempt = {
    state: 'Gestartet' as const,
    error: '',
    started_by: actor,
    started_at: new Date().toISOString(),
  };
  const values = {
    ...attempt,
    file_name: fileName,
    costunit_id: choice.costUnitId,
    costunit_name: choice.costUnitName,
    category_id: choice.categoryId,
    category_name: choice.categoryName,
    ...snapshot(beleg),
  };
  const id = Number(beleg.id);
  if (!previous) {
    try {
      const inserted = await getDb()
        .insertInto('organisation.beleg_campflow')
        .values({ beleg_id: id, ...values })
        .output('inserted.version')
        .executeTakeFirstOrThrow();
      return inserted.version;
    } catch (error: unknown) {
      // 2627: someone else started a transfer of this receipt at the same moment
      if (getSqlErrorNumber(error) === 2627) throw new VersionConflictError();
      throw error;
    }
  }
  const updated = await getDb()
    .updateTable('organisation.beleg_campflow')
    .set(previous.state === 'Gestartet' ? attempt : values)
    .where('beleg_id', '=', id)
    .where('version', '=', previous.version)
    .output('inserted.version')
    .executeTakeFirst();
  if (!updated) throw new VersionConflictError();
  return updated.version;
}

/**
 * Stores the result of the attempt that wrote `attempt`. If another attempt started meanwhile,
 * the row is that one's: its own result counts, this one changes nothing.
 */
async function finishAttempt(
  id: number,
  attempt: Buffer,
  values:
    | { state: 'Fehlgeschlagen' | 'Gestartet'; error: string }
    | {
        state: 'Hochgeladen';
        campflow_number: string;
        campflow_receipt_id: string;
        campflow_expense_id: string;
      },
  /** What CampFlow got, if this attempt created the booking. */
  sent?: StoredBeleg
): Promise<void> {
  await getDb()
    .updateTable('organisation.beleg_campflow')
    .set(
      values.state === 'Hochgeladen'
        ? {
            ...values,
            ...(sent ? snapshot(sent) : {}),
            error: '',
            uploaded_at: sql<string>`SYSUTCDATETIME()`,
          }
        : { state: values.state, error: values.error.slice(0, 1000) }
    )
    .where('beleg_id', '=', id)
    .where('version', '=', attempt)
    .execute();
}

/**
 * Transfers the receipt to CampFlow if it is accepted and still has the version `etag`, then
 * deletes it. A receipt uploaded already is only deleted.
 */
export async function transferBelegToCampflow(
  id: number,
  etag: string,
  actor: string,
  /** When the answer must be sent (`Date.now()` milliseconds). */
  deadline: number = Date.now() + 40_000
): Promise<BelegCampflowResult> {
  const beleg = await getBeleg(id);
  if (!beleg) throw new RecordNotFoundError();
  // Transfer exactly what the Kasse has seen, and only accepted receipts
  if (!requireVersion(etag).equals(requireVersion(beleg.etag))) throw new VersionConflictError();
  if (beleg.status !== 'Angenommen') {
    throw new BelegCampflowError(
      422,
      'NOT_ACCEPTED',
      'Nur angenommene Belege können nach CampFlow übertragen werden.'
    );
  }

  let created = false;
  let row = await getBelegCampflowRow(id);
  if (row?.state !== 'Hochgeladen') {
    // Only one attempt at a time: overlapping ones could book on one target and store another's
    // details. A finished unclear attempt has its error stored and may be repeated right away.
    if (
      row?.state === 'Gestartet' &&
      row.error === '' &&
      Date.now() - row.started_at.getTime() < RUNNING_MS
    ) {
      throw new BelegCampflowError(
        423,
        'TRANSFER_RUNNING',
        'Dieser Beleg wird gerade nach CampFlow übertragen. Bitte einen Moment warten und die Seite neu laden.'
      );
    }
    /** After an unclear attempt every failure stays unclear: that one may have written. */
    const wasUnclear = row?.state === 'Gestartet';
    if (!beleg.photo) {
      throw new BelegCampflowError(400, 'NO_PHOTO', 'Der Beleg hat kein Foto.');
    }
    if (!beleg.date) {
      throw new BelegCampflowError(400, 'NO_DATE', 'Bitte zuerst ein Belegdatum eintragen.');
    }
    try {
      getEnvironment(EnvironmentVariable.PLAYWRIGHT_API_KEY);
    } catch {
      throw new BelegCampflowError(
        503,
        'PLAYWRIGHT_KEY_REQUIRED',
        'Die Übertragung nach CampFlow ist noch nicht eingerichtet. Es wurde nichts übertragen. Bitte wende dich an admin@stamm-phoenix.de.'
      );
    }

    // After an unclear attempt the same file name, Kostenstelle and Kategorie must be used again,
    // or the Playwright API would not find what that attempt may have created.
    const target: BelegCampflowTarget =
      row?.state === 'Gestartet'
        ? {
            costUnitId: row.costunit_id,
            categoryId: row.category_id,
            costUnitName: row.costunit_name,
            categoryName: row.category_name,
          }
        : await resolveTarget(beleg, deadline);
    // After a refused attempt CampFlow holds nothing under the stored name, so its ending follows
    // a photo replaced by a PDF or back; after an unclear one the name must stay as it was
    const fileName =
      row?.state === 'Fehlgeschlagen'
        ? row.file_name.replace(/\.(jpg|pdf)$/, beleg.isPdf ? '.pdf' : '.jpg')
        : (row?.file_name ?? campflowFileName(beleg));
    const attempt = await startAttempt(beleg, target, fileName, row, actor);

    // CampFlow is not called yet, so a failure here wrote nothing there
    let photo: Buffer | undefined;
    try {
      // A PDF goes as it is, not its first page
      photo = await readBelegPhoto(id, beleg.photo, 'file');
    } catch (error: unknown) {
      await finishAttempt(id, attempt, {
        state: wasUnclear ? 'Gestartet' : 'Fehlgeschlagen',
        error: 'Foto konnte nicht geladen werden',
      });
      throw new BelegCampflowError(
        502,
        'PHOTO_UNAVAILABLE',
        'Das Foto des Belegs konnte gerade nicht geladen werden. Es wurde nichts übertragen. Bitte versuche es gleich noch einmal.',
        { cause: error }
      );
    }
    if (!photo) {
      await finishAttempt(id, attempt, {
        state: wasUnclear ? 'Gestartet' : 'Fehlgeschlagen',
        error: 'Foto nicht gefunden',
      });
      throw new BelegCampflowError(400, 'NO_PHOTO', 'Das Foto des Belegs wurde nicht gefunden.');
    }

    try {
      const uploaded = await uploadCampflowBeleg({
        filename: fileName,
        content: photo,
        description: campflowDescription(beleg),
        date: beleg.date,
        ...(beleg.art === 'Einnahme' ? { type: 'income' as const } : {}),
        amountCent: beleg.amountCent,
        disburser: campflowDisburser(beleg),
        costUnit: target.costUnitId,
        category: target.categoryId,
      });
      created = uploaded.created;
      // An existing booking came from an earlier attempt, whose details the row keeps. After an
      // unclear attempt even a new booking may use the file that attempt uploaded, so it counts
      // as this receipt only if nothing changed since; otherwise it stays here to be checked.
      const sentNow =
        created && (!wasUnclear || row?.beleg_version.equals(requireVersion(beleg.etag)) === true);
      await finishAttempt(
        id,
        attempt,
        {
          state: 'Hochgeladen',
          campflow_number: uploaded.number,
          campflow_receipt_id: uploaded.receiptId,
          campflow_expense_id: uploaded.expenseId,
        },
        sentNow ? beleg : undefined
      );
    } catch (error: unknown) {
      if (!(error instanceof PlaywrightApiError)) throw error;
      const definite = NOTHING_WRITTEN.has(error.status);
      const detail = error.detail || error.message;
      await finishAttempt(id, attempt, {
        state: definite && !wasUnclear ? 'Fehlgeschlagen' : 'Gestartet',
        error: detail,
      });
      throw definite
        ? new BelegCampflowError(
            502,
            'CAMPFLOW_REJECTED',
            `CampFlow hat den Beleg nicht angelegt: ${detail}`
          )
        : new BelegCampflowError(
            502,
            'CAMPFLOW_UNCLEAR',
            'Unklar, ob der Beleg in CampFlow angekommen ist. Erneut übertragen ist sicher: ' +
              'Ein schon angekommener Beleg wird erkannt und nicht doppelt angelegt.'
          );
    }
    row = await getBelegCampflowRow(id);
  }
  if (!row) throw new RecordNotFoundError();

  // Only a receipt that still looks like what CampFlow got is deleted; a correction made after
  // the upload stays, so the Kasse can fix CampFlow and then delete it by hand. If a newer
  // attempt took over meanwhile, its result decides.
  let deleted = row.state === 'Hochgeladen' && row.beleg_version.equals(requireVersion(etag));
  if (deleted) {
    try {
      await deleteBeleg(id, etag);
    } catch (error: unknown) {
      // Deleted by hand while it was uploaded: the booking stays in the history all the same
      if (error instanceof RecordNotFoundError) {
        await getDb()
          .updateTable('organisation.beleg_campflow')
          .set({ beleg_deleted_at: sql<string>`SYSUTCDATETIME()` })
          .where('beleg_id', '=', id)
          .where('state', '=', 'Hochgeladen')
          .where('beleg_deleted_at', 'is', null)
          .execute();
        return { campflow: toBelegCampflow(row), created, deleted: true };
      }
      if (!(error instanceof VersionConflictError)) throw error;
      deleted = false;
    }
  }
  return { campflow: toBelegCampflow(row), created, deleted };
}
