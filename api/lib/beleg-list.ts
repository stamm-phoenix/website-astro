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
import type { BelegTable } from './db-schema';
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

function toBeleg(row: Selectable<BelegTable>): StoredBeleg {
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
    photo: row.photo,
  };
}

/** Without the name of the photo, which stays on the server. */
export function toStaffBeleg(beleg: StoredBeleg): StaffBeleg {
  const staff: StaffBeleg & { photo?: string | null } = { ...beleg };
  delete staff.photo;
  return staff;
}

/** All receipts, newest first. */
export async function getBelege(): Promise<StoredBeleg[]> {
  const rows = await getDb()
    .selectFrom('organisation.beleg')
    .selectAll()
    .orderBy('submitted_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return rows.map(toBeleg);
}

export async function getBeleg(id: number): Promise<StoredBeleg | undefined> {
  const row = await getDb()
    .selectFrom('organisation.beleg')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toBeleg(row) : undefined;
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

/** Saves details and review state if the receipt still has the version `etag`. */
export async function updateBeleg(
  id: number,
  input: BelegInput,
  etag: string,
  actor: string
): Promise<void> {
  const result = await getDb()
    .updateTable('organisation.beleg')
    .set({ ...toColumns(input), updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) await notChanged(id);
  await removeFiles();
}

/** Deletes a receipt and its photo if it still has the version `etag`. */
export async function deleteBeleg(id: number, etag: string): Promise<void> {
  const row = await getDb()
    .deleteFrom('organisation.beleg')
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .output('deleted.photo')
    .executeTakeFirst();
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
): Promise<void> {
  const previous = await getBeleg(id);
  if (!previous) throw new RecordNotFoundError();
  const photo = await storeBelegPhoto(id, photos.photo, photos.original);
  let updated = false;
  try {
    const aiCheck = check ? await check : undefined;
    const result = await getDb()
      .updateTable('organisation.beleg')
      .set({
        photo,
        ...(check ? { ai_check: aiCheck ? JSON.stringify(aiCheck) : null } : {}),
        updated_by: actor,
        updated_at: sql<Date>`SYSUTCDATETIME()`,
      })
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    updated = Number(result.numUpdatedRows) > 0;
  } finally {
    if (!updated) await removeFiles(() => deleteBelegPhoto(id, photo));
  }
  if (!updated) await notChanged(id);
  const old = previous.photo;
  if (old && old !== photo) await removeFiles(() => deleteBelegPhoto(id, old));
}
