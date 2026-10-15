import { deleteBelegPhoto, storeBelegPhoto } from './beleg-photos';
import { lockContentIds, recordContentIds } from './content-ids';
import { CONFIG } from './config';
import { inTransaction, lockResource } from './db';
import type { BelegStatus } from './pflege-validation';
import { BELEG_STATUSES } from './pflege-validation';
import { getSharePointListItems } from './sharepoint-data-access';
import type { ImportSummary, ListItem } from './sharepoint-import-common';
import {
  assertEmpty,
  chunks,
  countRows,
  dateOrNull,
  forEachLimited,
  imageFileName,
  isImported,
  itemId,
  markImported,
  readAttachment,
  text,
} from './sharepoint-import-common';

/**
 * Takeover of the SharePoint list „Belege“ into `organisation.beleg` (migration
 * `0026_aktionen_belege_instagram.sql`), with the photos (and the originals of scans) as files in
 * Blob Storage; see `sharepoint-import.ts`. Previews are made on their first request
 * (`beleg-photos.ts`), which keeps the takeover short.
 */

export interface SourceBeleg {
  id: number;
  shop: string;
  date: string | null;
  amountCent: number;
  paidBy: string;
  payout: boolean;
  aktion: string;
  note: string;
  status: BelegStatus;
  reviewNote: string;
  submittedBy: string;
  submittedAt: string;
  /** Attachment of the image column, if any. */
  photoFile?: string;
  /** JSON of the preliminary check, if it is valid JSON. */
  aiCheck: string | null;
}

const PHOTO_CONCURRENCY = 4;

function toStatus(value: unknown): BelegStatus {
  const status = text(value);
  return (BELEG_STATUSES as readonly string[]).includes(status)
    ? (status as BelegStatus)
    : 'Eingereicht';
}

function json(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return null;
  }
}

function timestamp(value: unknown): string {
  const parsed = Date.parse(text(value));
  return new Date(Number.isNaN(parsed) ? Date.now() : parsed).toISOString();
}

/** Reads the SharePoint list „Belege“. */
export async function readBelegeList(): Promise<SourceBeleg[]> {
  const items = (await getSharePointListItems(CONFIG.sharepoint.lists.belege, {
    expand: 'fields',
  })) as ListItem<Record<string, unknown>>[];
  return items.map(({ id, createdDateTime, fields }) => {
    const amount = typeof fields.BetragCent === 'number' ? Math.round(fields.BetragCent) : 0;
    return {
      id: itemId(id),
      shop: text(fields.Title),
      date: dateOrNull(fields.Belegdatum),
      amountCent: Math.max(0, amount),
      paidBy: text(fields.BezahltVon),
      payout: fields.Auszahlung === true,
      aktion: text(fields.Aktion),
      note: text(fields.Bemerkung),
      status: toStatus(fields.Status),
      reviewNote: text(fields.Pruefnotiz),
      submittedBy: text(fields.EingereichtVon),
      submittedAt: timestamp(createdDateTime),
      photoFile: imageFileName(fields.Beleg),
      aiCheck: json(fields.KiPruefung),
    };
  });
}

/** The photo attachment of a receipt, or undefined if SharePoint does not have it. */
export function readBelegAttachment(id: number, fileName: string): Promise<Uint8Array | undefined> {
  return readAttachment(CONFIG.sharepoint.lists.belege, id, fileName);
}

/**
 * Copies the photos (and the originals of scans) into Blob Storage before the rows are written,
 * under names of this run, so a run that loses to another one or fails deletes only its own
 * files. A photo SharePoint does not have is left out and reported; a missing original only
 * makes the scan a plain photo. Any other error stops the import.
 */
async function copyPhotos(
  items: readonly SourceBeleg[],
  stored: Map<number, string>
): Promise<string[]> {
  const missing: string[] = [];
  const withPhoto = items.filter((item) => item.photoFile !== undefined);
  await forEachLimited(withPhoto, PHOTO_CONCURRENCY, async (item) => {
    const file = item.photoFile ?? '';
    const photo = await readBelegAttachment(item.id, file);
    if (!photo) {
      missing.push(String(item.id));
      return;
    }
    const originalFile = /-scan\.jpg$/.test(file)
      ? file.replace(/-scan\.jpg$/, '-original.jpg')
      : undefined;
    const original = originalFile ? await readBelegAttachment(item.id, originalFile) : undefined;
    try {
      stored.set(item.id, await storeBelegPhoto(item.id, photo, original));
    } catch (error: unknown) {
      // Blob Storage errors carry a status code; anything else is an attachment that is no
      // readable image
      if ((error as { statusCode?: unknown })?.statusCode !== undefined) throw error;
      missing.push(String(item.id));
    }
  });
  return missing.sort((a, b) => Number(a) - Number(b));
}

/** Copies the receipts with their photos; see `importSharePointList`. */
export async function importBelege(): Promise<ImportSummary | undefined> {
  const items = await readBelegeList();
  const stored = new Map<number, string>();
  let summary: ImportSummary | undefined;
  try {
    const missingPhotos = await copyPhotos(items, stored);
    summary = await writeBelege(items, stored, missingPhotos);
    return summary;
  } finally {
    // Another run took over the list first, or this one failed: its files are not referenced
    if (!summary) {
      // Left over files are removed later by `deleteOrphanedBelegPhotos`
      for (const [id, photo] of stored) await deleteBelegPhoto(id, photo).catch(() => undefined);
    }
  }
}

async function writeBelege(
  items: readonly SourceBeleg[],
  stored: ReadonlyMap<number, string>,
  missingPhotos: string[]
): Promise<ImportSummary | undefined> {
  const list = 'belege';
  return inTransaction(async (trx) => {
    await lockResource(trx, `content:sharepoint-import:${list}`);
    if (await isImported(trx, list)) return undefined;
    await lockContentIds(trx, 'organisation.beleg');
    await assertEmpty(trx, 'organisation.beleg');
    for (const chunk of chunks(items)) {
      await trx
        .insertInto('organisation.beleg')
        .values(
          chunk.map((item) => ({
            id: item.id,
            shop: item.shop,
            beleg_date: item.date,
            amount_cent: item.amountCent,
            paid_by: item.paidBy,
            payout: item.payout,
            aktion: item.aktion,
            note: item.note,
            status: item.status,
            review_note: item.reviewNote,
            submitted_by: item.submittedBy,
            submitted_at: item.submittedAt,
            photo: stored.get(item.id) ?? null,
            ai_check: item.aiCheck,
            updated_by: 'SharePoint',
          }))
        )
        .execute();
    }
    await recordContentIds(trx, 'organisation.beleg');
    const count = await countRows(trx, 'organisation.beleg');
    if (count !== items.length) throw new Error(`Imported ${count} of ${items.length} Belege`);
    const summary: ImportSummary = { items: count, photos: stored.size, missingPhotos };
    await markImported(trx, list, summary);
    return summary;
  });
}
