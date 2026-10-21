import type { HttpResponseInit } from '@azure/functions';
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
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  getSqlErrorNumber,
  requireVersion,
} from './db';
import { EnvironmentVariable, getEnvironment } from './environment';
import { PlaywrightApiError, getKostenstellen, uploadCampflowBeleg } from './playwright-api';
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
 * - `Hochgeladen`: booked in CampFlow with a number. Only then is the receipt deleted.
 */

/** Answers of the Playwright API that come before anything was written to CampFlow. */
const NOTHING_WRITTEN = new Set([400, 401, 403, 404, 409, 413, 503]);
/** The Playwright API limits file names to 200 characters and descriptions to 255. */
const MAX_SHOP_IN_FILE_NAME = 80;
const MAX_DESCRIPTION = 255;

export class BelegCampflowError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'BelegCampflowError';
  }

  toResponse(): HttpResponseInit {
    return errorResponse(this.status, this.code, this.message);
  }
}

export interface BelegCampflowChoice {
  /** `cun_…` */
  costUnitId: string;
  /** `cat_…` */
  categoryId: string;
}

export interface BelegCampflowResult {
  campflow: BelegCampflow;
  /** False if CampFlow had the receipt already from an earlier attempt. */
  created: boolean;
  /** False if the receipt was changed meanwhile and stays; it can be deleted by hand. */
  deleted: boolean;
}

/**
 * File name in CampFlow, e.g. `2026-09-30 REWE 12,34 EUR (Website-Beleg 123).jpg`. The ID makes
 * it unique, which the Playwright API needs to recognise a receipt it has uploaded before.
 */
export function campflowFileName(beleg: StoredBeleg): string {
  const shop = beleg.shop.trim().slice(0, MAX_SHOP_IN_FILE_NAME);
  const name = downloadFileName({ ...beleg, shop }).replace(/\.jpg$/, '');
  return `${name} (Website-Beleg ${beleg.id}).jpg`;
}

/** „Beschreibung“ in CampFlow: shop and note, and who paid if nobody wants the money back. */
export function campflowDescription(beleg: StoredBeleg): string {
  const paidBy = !beleg.payout && beleg.paidBy.trim() ? `bezahlt von ${beleg.paidBy.trim()}` : '';
  const text = [beleg.shop.trim(), beleg.note.trim(), paidBy]
    .filter(Boolean)
    .join(' – ')
    .replace(/\s+/g, ' ');
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}

/** „Auslage durch“: only the person who wants the money back. */
export function campflowDisburser(beleg: StoredBeleg): string | null {
  return beleg.payout && beleg.paidBy.trim() ? beleg.paidBy.trim() : null;
}

async function resolveChoice(
  choice: BelegCampflowChoice
): Promise<{ costUnitName: string; categoryName: string }> {
  let units;
  try {
    units = await getKostenstellen();
  } catch (error: unknown) {
    if (!(error instanceof PlaywrightApiError)) throw error;
    throw new BelegCampflowError(
      502,
      'KOSTENSTELLEN_UNAVAILABLE',
      'Die Kostenstellen konnten nicht aus CampFlow geladen werden. Es wurde nichts übertragen.'
    );
  }
  const unit = units.find(({ id }) => id === choice.costUnitId);
  const category = unit?.categories.find(({ id }) => id === choice.categoryId);
  if (!unit || !category) {
    throw new BelegCampflowError(
      400,
      'INVALID_CHOICE',
      'Diese Kostenstelle oder Kategorie gibt es in CampFlow nicht (mehr). Bitte neu wählen.'
    );
  }
  if (unit.archived) {
    throw new BelegCampflowError(
      409,
      'KOSTENSTELLE_ARCHIVED',
      `Die Kostenstelle „${unit.name}“ ist in CampFlow archiviert.`
    );
  }
  return { costUnitName: unit.name, categoryName: category.name };
}

/** Stores the attempt before CampFlow is called; a concurrent attempt makes it a conflict. */
async function startAttempt(
  beleg: StoredBeleg,
  choice: BelegCampflowChoice & { costUnitName: string; categoryName: string },
  fileName: string,
  previousVersion: Buffer | undefined,
  actor: string
): Promise<void> {
  const values = {
    state: 'Gestartet' as const,
    file_name: fileName,
    costunit_id: choice.costUnitId,
    costunit_name: choice.costUnitName,
    category_id: choice.categoryId,
    category_name: choice.categoryName,
    shop: beleg.shop,
    beleg_date: beleg.date || null,
    amount_cent: beleg.amountCent,
    error: '',
    started_by: actor,
    started_at: new Date().toISOString(),
  };
  const id = Number(beleg.id);
  if (!previousVersion) {
    try {
      await getDb()
        .insertInto('organisation.beleg_campflow')
        .values({ beleg_id: id, ...values })
        .execute();
    } catch (error: unknown) {
      // 2627: someone else started a transfer of this receipt at the same moment
      if (getSqlErrorNumber(error) === 2627) throw new VersionConflictError();
      throw error;
    }
    return;
  }
  const result = await getDb()
    .updateTable('organisation.beleg_campflow')
    .set(values)
    .where('beleg_id', '=', id)
    .where('version', '=', previousVersion)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
}

async function finishAttempt(
  id: number,
  values:
    | { state: 'Fehlgeschlagen' | 'Gestartet'; error: string }
    | {
        state: 'Hochgeladen';
        campflow_number: string;
        campflow_receipt_id: string;
        campflow_expense_id: string;
      }
): Promise<void> {
  await getDb()
    .updateTable('organisation.beleg_campflow')
    .set(
      values.state === 'Hochgeladen'
        ? { ...values, error: '', uploaded_at: sql<string>`SYSUTCDATETIME()` }
        : { state: values.state, error: values.error.slice(0, 1000) }
    )
    .where('beleg_id', '=', id)
    .where('state', '<>', 'Hochgeladen')
    .execute();
}

/**
 * Transfers the receipt to CampFlow if it is accepted and still has the version `etag`, then
 * deletes it. A receipt uploaded already is only deleted.
 */
export async function transferBelegToCampflow(
  id: number,
  etag: string,
  choice: BelegCampflowChoice,
  actor: string
): Promise<BelegCampflowResult> {
  const beleg = await getBeleg(id);
  if (!beleg) throw new RecordNotFoundError();
  // Transfer exactly what the Kasse has seen, and only accepted receipts
  if (!requireVersion(etag).equals(requireVersion(beleg.etag))) throw new VersionConflictError();
  if (beleg.status !== 'Angenommen') {
    throw new BelegCampflowError(
      409,
      'NOT_ACCEPTED',
      'Nur angenommene Belege können nach CampFlow übertragen werden.'
    );
  }

  let created = false;
  let row = await getBelegCampflowRow(id);
  if (row?.state !== 'Hochgeladen') {
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
        'Für die Übertragung nach CampFlow ist kein Schlüssel der Playwright-API eingerichtet.'
      );
    }

    // After an unclear attempt the same file name, Kostenstelle and Kategorie must be used again,
    // or the Playwright API would not find what that attempt may have created.
    const target =
      row?.state === 'Gestartet'
        ? {
            costUnitId: row.costunit_id,
            categoryId: row.category_id,
            costUnitName: row.costunit_name,
            categoryName: row.category_name,
          }
        : { ...choice, ...(await resolveChoice(choice)) };
    const fileName = row?.file_name ?? campflowFileName(beleg);
    await startAttempt(beleg, target, fileName, row?.version, actor);

    const photo = await readBelegPhoto(id, beleg.photo, 'photo');
    if (!photo) {
      await finishAttempt(id, { state: 'Fehlgeschlagen', error: 'Foto nicht gefunden' });
      throw new BelegCampflowError(400, 'NO_PHOTO', 'Das Foto des Belegs wurde nicht gefunden.');
    }

    try {
      const uploaded = await uploadCampflowBeleg({
        filename: fileName,
        content: photo,
        description: campflowDescription(beleg),
        date: beleg.date,
        amountCent: beleg.amountCent,
        disburser: campflowDisburser(beleg),
        costUnit: target.costUnitId,
        category: target.categoryId,
      });
      created = uploaded.created;
      await finishAttempt(id, {
        state: 'Hochgeladen',
        campflow_number: uploaded.number,
        campflow_receipt_id: uploaded.receiptId,
        campflow_expense_id: uploaded.expenseId,
      });
    } catch (error: unknown) {
      if (!(error instanceof PlaywrightApiError)) throw error;
      const definite = NOTHING_WRITTEN.has(error.status);
      const detail = error.detail || error.message;
      await finishAttempt(id, { state: definite ? 'Fehlgeschlagen' : 'Gestartet', error: detail });
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

  let deleted = true;
  try {
    await deleteBeleg(id, etag);
  } catch (error: unknown) {
    if (!(error instanceof VersionConflictError)) throw error;
    deleted = false;
  }
  if (deleted) {
    await getDb()
      .updateTable('organisation.beleg_campflow')
      .set({ beleg_deleted_at: sql<string>`SYSUTCDATETIME()` })
      .where('beleg_id', '=', id)
      .execute();
  }
  return { campflow: toBelegCampflow(row), created, deleted };
}
