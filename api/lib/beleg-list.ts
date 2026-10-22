import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type { BelegCheck } from './beleg-check';
import { parseStoredBelegCheck } from './beleg-check';
import {
  deleteBelegPhoto,
  deleteOrphanedBelegPhotos,
  originalFileName,
  storeBelegPhoto,
} from './beleg-photos';
import { nextContentId } from './content-ids';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type { BelegCampflowState, BelegCampflowTable, BelegTable } from './db-schema';
import type { BelegInput, BelegStatus } from './pflege-validation';

/**
 * The Belege in Azure SQL (`organisation.beleg`, migration `0026_aktionen_belege_instagram.sql`)
 * with their photos in Blob Storage (`beleg-photos.ts`).
 */

/** A receipt as sent to the Leitendenbereich. */
export interface StaffBeleg {
  id: string;
  etag: string;
  shop: string;
  date: string;
  amountCent: number;
  paidBy: string;
  payout: boolean;
  aktion: string;
  note: string;
  status: BelegStatus;
  reviewNote: string;
  submittedBy: string;
  submittedAt: string;
  hasImage: boolean;
  /** Whether the unedited photo is stored next to the scan. */
  hasOriginal: boolean;
  /** Preliminary check of the photo by the image model, if configured. */
  aiCheck: BelegCheck | null;
  /** The last transfer to CampFlow (`beleg-campflow.ts`), null if there was none. */
  campflow: BelegCampflow | null;
  /** Someone else submitted the user's Auslage: they may look at it, not change it. */
  readOnly?: true;
  /** An Auslage of the user asking, by the names the server knows for them. */
  mine?: true;
}

/** Transfer of a receipt to CampFlow, as the Kasse sees it. */
export interface BelegCampflow {
  state: BelegCampflowState;
  costUnitId: string;
  costUnitName: string;
  categoryId: string;
  categoryName: string;
  /** Belegnummer in CampFlow once uploaded, e.g. `2026-112`. */
  number: string | null;
  /** What went wrong in the last attempt; empty after success. */
  error: string;
  startedBy: string;
  startedAt: string;
}

/** A receipt with the name of its photo, for the photo endpoint. */
export interface StoredBeleg extends StaffBeleg {
  photo: string | null;
}

export interface BelegPhotos {
  /** The photo for the archive: the scan, or the photo itself if it was not edited. */
  photo: Uint8Array;
  /** The unedited photo, if `photo` is a scan of it. */
  original?: Uint8Array;
}

/** The columns of a transfer the receipt list shows. */
type CampflowColumns = Pick<
  Selectable<BelegCampflowTable>,
  | 'state'
  | 'costunit_id'
  | 'costunit_name'
  | 'category_id'
  | 'category_name'
  | 'campflow_number'
  | 'error'
  | 'started_by'
  | 'started_at'
>;

export function toBelegCampflow(row: CampflowColumns): BelegCampflow {
  return {
    state: row.state,
    costUnitId: row.costunit_id,
    costUnitName: row.costunit_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    number: row.campflow_number,
    error: row.error,
    startedBy: row.started_by,
    startedAt: row.started_at.toISOString(),
  };
}

function toBeleg(row: Selectable<BelegTable>, campflow: CampflowColumns | undefined): StoredBeleg {
  return {
    id: String(row.id),
    etag: toVersion(row.version),
    shop: row.shop,
    date: row.beleg_date === null ? '' : toDateString(row.beleg_date),
    amountCent: row.amount_cent,
    paidBy: row.paid_by,
    payout: row.payout,
    aktion: row.aktion,
    note: row.note,
    status: row.status,
    reviewNote: row.review_note,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at.toISOString(),
    hasImage: row.photo !== null,
    hasOriginal: originalFileName(row.photo) !== undefined,
    aiCheck: parseStoredBelegCheck(row.ai_check ?? undefined),
    campflow: campflow ? toBelegCampflow(campflow) : null,
    photo: row.photo,
  };
}

/** File name of the photo for CampFlow, e.g. `2026-10-01 REWE 12,34 EUR.jpg`. */
export function downloadFileName(beleg: StaffBeleg, original = false): string {
  const amount = (beleg.amountCent / 100).toFixed(2).replace('.', ',');
  const shop = beleg.shop.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Beleg';
  const suffix = original ? ' Original' : '';
  return `${beleg.date || 'Beleg'} ${shop} ${amount} EUR${suffix}.jpg`.replace(/\s+/g, ' ');
}

/** Without the name of the photo, which stays on the server. */
export function toStaffBeleg(beleg: StoredBeleg): StaffBeleg {
  const staff: StaffBeleg & { photo?: string | null } = { ...beleg };
  delete staff.photo;
  return staff;
}

/**
 * All receipts, newest first; with `submittedBy` only those of that login (compared without
 * regard to case, like the database collation), so nobody else's are read.
 */
/**
 * All receipts, or only those of one person: submitted by them, or an Auslage under one of
 * their names (the database compares without case; the caller checks the names exactly).
 */
export async function getBelege(of?: {
  submittedBy: string;
  auslageNames?: string[];
}): Promise<StoredBeleg[]> {
  let query = selectBelege();
  if (of) {
    const names = of.auslageNames ?? [];
    query = query.where((eb) =>
      names.length
        ? eb.or([
            eb('b.submitted_by', '=', of.submittedBy),
            eb.and([eb('b.payout', '=', true), eb('b.paid_by', 'in', names)]),
          ])
        : eb('b.submitted_by', '=', of.submittedBy)
    );
  }
  const rows = await query.orderBy('b.submitted_at', 'desc').orderBy('b.id', 'desc').execute();
  return rows.map(withTransfer);
}

export async function getBeleg(id: number): Promise<StoredBeleg | undefined> {
  const row = await selectBelege().where('b.id', '=', id).executeTakeFirst();
  return row ? withTransfer(row) : undefined;
}

/** Receipts with their transfer to CampFlow, in one query. */
function selectBelege() {
  return getDb()
    .selectFrom('organisation.beleg as b')
    .leftJoin('organisation.beleg_campflow as c', (join) =>
      join.onRef('c.beleg_id', '=', 'b.id').on('c.beleg_deleted_at', 'is', null)
    )
    .selectAll('b')
    .select([
      'c.state as cf_state',
      'c.costunit_id as cf_costunit_id',
      'c.costunit_name as cf_costunit_name',
      'c.category_id as cf_category_id',
      'c.category_name as cf_category_name',
      'c.campflow_number as cf_campflow_number',
      'c.error as cf_error',
      'c.started_by as cf_started_by',
      'c.started_at as cf_started_at',
    ]);
}

type BelegRow = Awaited<ReturnType<ReturnType<typeof selectBelege>['executeTakeFirstOrThrow']>>;

function withTransfer(row: BelegRow): StoredBeleg {
  const {
    cf_state: state,
    cf_costunit_id: costunit_id,
    cf_costunit_name: costunit_name,
    cf_category_id: category_id,
    cf_category_name: category_name,
    cf_campflow_number: campflow_number,
    cf_error: error,
    cf_started_by: started_by,
    cf_started_at: started_at,
    ...beleg
  } = row;
  const transfer =
    state === null ||
    costunit_id === null ||
    costunit_name === null ||
    category_id === null ||
    category_name === null ||
    error === null ||
    started_by === null ||
    started_at === null
      ? undefined
      : {
          state,
          costunit_id,
          costunit_name,
          category_id,
          category_name,
          campflow_number,
          error,
          started_by,
          started_at,
        };
  return toBeleg(beleg, transfer);
}

/** The transfer of a receipt to CampFlow, also of one deleted since. */
export function getBelegCampflowRow(
  id: number
): Promise<Selectable<BelegCampflowTable> | undefined> {
  return getDb()
    .selectFrom('organisation.beleg_campflow')
    .selectAll()
    .where('beleg_id', '=', id)
    .executeTakeFirst();
}

function toColumns(input: BelegInput): {
  shop: string;
  beleg_date: string | null;
  amount_cent: number;
  paid_by: string;
  payout: boolean;
  aktion: string;
  note: string;
  status: BelegStatus;
  review_note: string;
} {
  return {
    shop: input.shop,
    beleg_date: input.date || null,
    amount_cent: input.amountCent,
    paid_by: input.paidBy,
    payout: input.payout,
    aktion: input.aktion,
    note: input.note,
    status: input.status,
    review_note: input.reviewNote,
  };
}

/**
 * Deletes files after the rows were changed. The change is saved already, so a failure is only
 * logged; `deleteOrphanedBelegPhotos` runs after every change (also those that delete nothing)
 * and removes what was left.
 */
async function removeFiles(work: () => Promise<unknown> = async () => undefined): Promise<void> {
  const current = async (): Promise<void> => {
    const rows = await getDb().selectFrom('organisation.beleg').select(['id', 'photo']).execute();
    await deleteOrphanedBelegPhotos(new Map(rows.map((row) => [row.id, row.photo])));
  };
  for (const step of [work, current]) {
    try {
      await step();
    } catch (error: unknown) {
      console.warn(
        JSON.stringify({
          scope: 'beleg-photos',
          warning: 'Photo files could not be deleted; the next change of a receipt removes them',
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }
}

/**
 * Stores a new receipt with its photo. The ID is reserved first, so the photo is stored under it
 * before the row exists; without a row the files are deleted again.
 */
export async function createBeleg(
  input: BelegInput,
  submittedBy: string,
  photos: BelegPhotos,
  check: Promise<BelegCheck | undefined> | undefined
): Promise<string> {
  const id = await inTransaction((trx) => nextContentId(trx, 'organisation.beleg'));
  const photo = await storeBelegPhoto(id, photos.photo, photos.original);
  try {
    const aiCheck = check ? await check : undefined;
    await getDb()
      .insertInto('organisation.beleg')
      .values({
        id,
        ...toColumns(input),
        submitted_by: submittedBy,
        submitted_at: new Date().toISOString(),
        photo,
        ai_check: aiCheck ? JSON.stringify(aiCheck) : null,
        updated_by: submittedBy,
      })
      .execute();
  } catch (error: unknown) {
    // A receipt without its photo is of no use to the Kassenteam, a photo without receipt neither
    await removeFiles(() => deleteBelegPhoto(id, photo));
    throw error;
  }
  await removeFiles();
  return String(id);
}

async function notChanged(id: number): Promise<never> {
  const exists = await getDb()
    .selectFrom('organisation.beleg')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

/**
 * Saves details and review state if the receipt still has the version `etag`; returns the new
 * version, the one this change wrote.
 */
export async function updateBeleg(
  id: number,
  input: BelegInput,
  etag: string,
  actor: string
): Promise<string> {
  const row = await getDb()
    .updateTable('organisation.beleg')
    .set({ ...toColumns(input), updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .output('inserted.version')
    .executeTakeFirst();
  if (!row) return notChanged(id);
  await removeFiles();
  return toVersion(row.version);
}

/**
 * Deletes a receipt and its photo if it still has the version `etag`. A receipt uploaded to
 * CampFlow is marked as deleted in the same transaction, so it stays in the history.
 */
export async function deleteBeleg(id: number, etag: string): Promise<void> {
  const row = await inTransaction(async (trx) => {
    const deleted = await trx
      .deleteFrom('organisation.beleg')
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .output('deleted.photo')
      .executeTakeFirst();
    if (deleted) {
      await trx
        .updateTable('organisation.beleg_campflow')
        .set({ beleg_deleted_at: sql<string>`SYSUTCDATETIME()` })
        .where('beleg_id', '=', id)
        .where('state', '=', 'Hochgeladen')
        .execute();
    }
    return deleted;
  });
  if (!row) await notChanged(id);
  const photo = row?.photo;
  await removeFiles(async () => {
    if (photo) await deleteBelegPhoto(id, photo);
  });
}

/**
 * Replaces the photo (and the check, if `check` is given) if the receipt still has the version
 * `etag`. The new files get names of their own, so a refused change only deletes those.
 */
export async function setBelegPhoto(
  id: number,
  photos: BelegPhotos,
  etag: string,
  check: Promise<BelegCheck | undefined> | undefined,
  actor: string
): Promise<StaffBeleg> {
  const previous = await getBeleg(id);
  if (!previous) throw new RecordNotFoundError();
  const photo = await storeBelegPhoto(id, photos.photo, photos.original);
  let updated: Selectable<BelegTable> | undefined;
  try {
    const aiCheck = check ? await check : undefined;
    updated = await getDb()
      .updateTable('organisation.beleg')
      .set({
        photo,
        ...(check ? { ai_check: aiCheck ? JSON.stringify(aiCheck) : null } : {}),
        updated_by: actor,
        updated_at: sql<Date>`SYSUTCDATETIME()`,
      })
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .outputAll('inserted')
      .executeTakeFirst();
  } finally {
    if (!updated) await removeFiles(() => deleteBelegPhoto(id, photo));
  }
  if (!updated) return notChanged(id);
  const old = previous.photo;
  if (old && old !== photo) await removeFiles(() => deleteBelegPhoto(id, old));
  return toStaffBeleg(toBeleg(updated, await getBelegCampflowRow(id)));
}
