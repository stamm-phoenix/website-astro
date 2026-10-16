import type { HttpResponseInit } from '@azure/functions';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import {
  commitStagedBlob,
  deleteBlob,
  deleteBlobs,
  getBlob,
  listBlobs,
  listStagedParts,
  openBlob,
  putBlob,
  stageBlobPart,
} from './blob-storage';
import {
  getDb,
  getSqlErrorNumber,
  inTransaction,
  lockResource,
  RecordNotFoundError,
  toVersion,
  VersionConflictError,
} from './db';
import { MAX_UPLOAD_BYTES, UPLOAD_PART_BYTES, downloadMimeType } from './pflege-validation';
import { encodeContentDisposition } from './response-utils';

/**
 * The public downloads (#165): name, size and stand in `content.download` (migration
 * `0027_downloads.sql`), the files with their preview images in Blob Storage:
 *
 * - `downloads/<file_key>/datei`: the file itself
 * - `downloads/<file_key>/vorschau-klein.jpg`, `…/vorschau-gross.jpg`: the previews, if any
 *
 * Every uploaded version gets a new random `file_key`, so a replaced file is never served from
 * a half-written blob, and a version is only deleted after the row points elsewhere. Uploads
 * go through the API in parts of `UPLOAD_PART_BYTES` (`stageUploadPart`, `completeUpload`).
 */

export interface StoredDownload {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  hasPreview: boolean;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  /** Version for renaming and deleting; files still in SharePoint have none. */
  etag?: string;
}

export type PreviewSize = 'small' | 'large';

const FILE = 'datei';
const PREVIEW_FILES: Record<PreviewSize, string> = {
  small: 'vorschau-klein.jpg',
  large: 'vorschau-gross.jpg',
};
/** Widths of the previews; the public list shows them about 64 px wide. */
const PREVIEW_WIDTHS: Record<PreviewSize, number> = { small: 128, large: 400 };
// A preview is at most a few hundred kB; a JPEG with more pixels is a decompression bomb
const MAX_PREVIEW_PIXELS = 8000 * 8000;
/** Files written before their row: younger ones may still be on their way into a row. */
const ORPHAN_MIN_AGE_MS = 10 * 60_000;
const MAX_PARTS = Math.ceil(MAX_UPLOAD_BYTES / UPLOAD_PART_BYTES);

const ROOT = 'downloads/';

export function downloadBlobName(key: string, file: string = FILE): string {
  return `${ROOT}${key}/${file}`;
}

/** A new random key: the ID of a new download or the folder of an uploaded version. */
export function newDownloadKey(): string {
  return randomBytes(16).toString('base64url');
}

export function isDownloadKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(value);
}

/** IDs taken over from SharePoint (`01ABC…`, `b!…`-style) and random ones. */
export function isDownloadId(value: string): boolean {
  return /^[A-Za-z0-9!_-]{1,64}$/.test(value);
}

interface DownloadRow {
  id: string;
  file_name: string;
  file_key: string;
  size: string | number;
  mime_type: string;
  has_preview: boolean;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  version: Buffer;
}

function toDownload(row: DownloadRow): StoredDownload {
  return {
    id: row.id,
    fileName: row.file_name,
    size: Number(row.size),
    mimeType: row.mime_type,
    hasPreview: row.has_preview,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    lastModifiedAt: row.updated_at.toISOString(),
    lastModifiedBy: row.updated_by,
    etag: toVersion(row.version),
  };
}

const COLUMNS = [
  'id',
  'file_name',
  'file_key',
  'size',
  'mime_type',
  'has_preview',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'version',
] as const;

/** All downloads, newest change first. */
export async function listDownloads(): Promise<StoredDownload[]> {
  const rows = await getDb()
    .selectFrom('content.download')
    .select(COLUMNS)
    .orderBy('updated_at', 'desc')
    .orderBy('file_name')
    .execute();
  return rows.map(toDownload);
}

async function findRow(id: string): Promise<DownloadRow | undefined> {
  if (!isDownloadId(id)) return undefined;
  return getDb()
    .selectFrom('content.download')
    .select(COLUMNS)
    .where('id', '=', id)
    .executeTakeFirst();
}

/** The file of a download as a response, or undefined if there is none. */
export async function serveDownloadFile(id: string): Promise<HttpResponseInit | undefined> {
  const row = await findRow(id);
  if (!row) return undefined;
  const blob = await openBlob(downloadBlobName(row.file_key));
  if (!blob) return undefined;
  return {
    status: 200,
    headers: {
      'Content-Type': row.mime_type,
      'Content-Length': String(blob.size),
      'Content-Disposition': encodeContentDisposition(row.file_name),
      'X-Content-Type-Options': 'nosniff',
    },
    body: blob.stream as unknown as AsyncIterable<Uint8Array>,
  };
}

/** A preview image of a download, or undefined if there is none. */
export async function serveDownloadPreview(
  id: string,
  size: PreviewSize
): Promise<HttpResponseInit | undefined> {
  const row = await findRow(id);
  if (!row?.has_preview) return undefined;
  const bytes = await getBlob(downloadBlobName(row.file_key, PREVIEW_FILES[size]));
  if (!bytes) return undefined;
  return {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.length) },
    body: new Uint8Array(bytes),
  };
}

/** Scales a preview image (any format sharp reads) to the stored JPEGs. */
export async function toPreviews(image: Uint8Array): Promise<Record<PreviewSize, Buffer>> {
  const scale = (width: number): Promise<Buffer> =>
    sharp(image, { limitInputPixels: MAX_PREVIEW_PIXELS })
      .rotate()
      .resize({ width, height: width * 2, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
  const [small, large] = await Promise.all([
    scale(PREVIEW_WIDTHS.small),
    scale(PREVIEW_WIDTHS.large),
  ]);
  return { small, large };
}

/** Stores the previews next to a version; false if the image cannot be read. */
export async function storePreviews(key: string, image: Uint8Array): Promise<boolean> {
  let previews: Record<PreviewSize, Buffer>;
  try {
    previews = await toPreviews(image);
  } catch (error: unknown) {
    console.warn(
      JSON.stringify({
        scope: 'downloads',
        warning: 'The preview image could not be read; the file is stored without a preview',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return false;
  }
  await Promise.all(
    (Object.keys(previews) as PreviewSize[]).map((size) =>
      putBlob(downloadBlobName(key, PREVIEW_FILES[size]), previews[size], 'image/jpeg')
    )
  );
  return true;
}

/** Whether a download with this name exists (regardless of case). */
export async function downloadNameExists(fileName: string): Promise<boolean> {
  const row = await getDb()
    .selectFrom('content.download')
    .select('id')
    .where('file_name', '=', fileName)
    .executeTakeFirst();
  return row !== undefined;
}

/** Stores one part of an upload; `index` counts from 0. */
export async function stageUploadPart(
  key: string,
  index: number,
  bytes: Uint8Array
): Promise<void> {
  await stageBlobPart(downloadBlobName(key), index, bytes);
}

export function isPartIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < MAX_PARTS;
}

export type CompleteResult =
  | { status: 'saved'; id: string }
  /** A download with this name exists and `replace` was not set; the parts are kept. */
  | { status: 'exists' }
  /** The parts are missing, incomplete or were used already: upload the file again. */
  | { status: 'incomplete' };

export interface CompleteInput {
  key: string;
  fileName: string;
  /** Bytes the browser sent; parts missing at the end make the upload incomplete. */
  size: number;
  replace: boolean;
  /** A picture of the first page or the image itself, as made by the browser. */
  preview?: Uint8Array;
}

/**
 * Puts the uploaded parts together and saves the download: with `replace`, a download with the
 * same name gets the new file and keeps its ID and link.
 */
export async function completeUpload(input: CompleteInput, actor: string): Promise<CompleteResult> {
  if (!input.replace && (await downloadNameExists(input.fileName))) return { status: 'exists' };

  const parts = await listStagedParts(downloadBlobName(input.key));
  const size = parts.reduce((total, part) => total + part.size, 0);
  const complete =
    parts.length > 0 &&
    size === input.size &&
    size <= MAX_UPLOAD_BYTES &&
    parts.every(
      (part, index) =>
        part.index === index &&
        part.size > 0 &&
        (index === parts.length - 1
          ? part.size <= UPLOAD_PART_BYTES
          : part.size === UPLOAD_PART_BYTES)
    );
  if (!complete) return { status: 'incomplete' };

  const mimeType = downloadMimeType(input.fileName);
  if (!(await commitStagedBlob(downloadBlobName(input.key), parts.length, mimeType))) {
    return { status: 'incomplete' };
  }

  let previous: string | undefined;
  let result: CompleteResult;
  try {
    const hasPreview = input.preview ? await storePreviews(input.key, input.preview) : false;
    const now = new Date().toISOString();
    result = await inTransaction(async (trx) => {
      await lockResource(trx, 'content.download');
      const existing = await trx
        .selectFrom('content.download')
        .select(['id', 'file_key'])
        .where('file_name', '=', input.fileName)
        .executeTakeFirst();
      const values = {
        file_name: input.fileName,
        file_key: input.key,
        size,
        mime_type: mimeType,
        has_preview: hasPreview,
        updated_at: now,
        updated_by: actor,
      };
      if (existing) {
        if (!input.replace) return { status: 'exists' as const };
        await trx
          .updateTable('content.download')
          .set(values)
          .where('id', '=', existing.id)
          .execute();
        // Never the version being saved, so a repeated completion cannot delete it
        previous = existing.file_key === input.key ? undefined : existing.file_key;
        return { status: 'saved' as const, id: existing.id };
      }
      const id = newDownloadKey();
      await trx
        .insertInto('content.download')
        .values({ id, ...values, created_at: now, created_by: actor })
        .execute();
      return { status: 'saved' as const, id };
    });
  } catch (error: unknown) {
    await removeFiles(() => deleteBlobs(`${ROOT}${input.key}/`));
    throw error;
  }
  // Someone saved the same name in the meantime: the committed parts cannot be used again
  if (result.status !== 'saved') {
    await removeFiles(() => deleteBlobs(`${ROOT}${input.key}/`));
    return { status: 'incomplete' };
  }
  const old = previous;
  await removeFiles(async () => {
    if (old) await deleteBlobs(`${ROOT}${old}/`);
  });
  return result;
}

/** A missing row is not found; a row with another version was changed in the meantime. */
async function noRowWritten(id: string): Promise<never> {
  if (await findRow(id)) throw new VersionConflictError();
  throw new RecordNotFoundError();
}

/**
 * Renames a download, only in the loaded version; false if another download has that name.
 */
export async function renameDownload(
  id: string,
  fileName: string,
  version: Buffer,
  actor: string
): Promise<boolean> {
  if (!isDownloadId(id)) throw new RecordNotFoundError();
  try {
    const result = await getDb()
      .updateTable('content.download')
      .set({
        file_name: fileName,
        mime_type: downloadMimeType(fileName),
        updated_at: new Date().toISOString(),
        updated_by: actor,
      })
      .where('id', '=', id)
      .where('version', '=', version)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) await noRowWritten(id);
    return true;
  } catch (error: unknown) {
    if ([2601, 2627].includes(getSqlErrorNumber(error) ?? 0)) return false;
    throw error;
  }
}

/** Deletes a download with its files, only in the loaded version. */
export async function deleteDownload(id: string, version: Buffer): Promise<void> {
  if (!isDownloadId(id)) throw new RecordNotFoundError();
  const row = await getDb()
    .deleteFrom('content.download')
    .where('id', '=', id)
    .where('version', '=', version)
    .output('deleted.file_key')
    .executeTakeFirst();
  if (!row) return noRowWritten(id);
  await removeFiles(() => deleteBlobs(`${ROOT}${row.file_key}/`));
}

/**
 * Deletes files that no download refers to, e.g. because the cleanup after a change failed.
 * Only files older than `ORPHAN_MIN_AGE_MS`: uploads store their files before the row.
 */
export async function deleteOrphanedDownloadFiles(now: number = Date.now()): Promise<number> {
  const [files, rows] = await Promise.all([
    listBlobs(ROOT),
    getDb().selectFrom('content.download').select('file_key').execute(),
  ]);
  const current = new Set(rows.map((row) => row.file_key));
  let deleted = 0;
  for (const file of files) {
    const key = file.name.slice(ROOT.length).split('/')[0];
    if (current.has(key) || now - file.lastModified.getTime() < ORPHAN_MIN_AGE_MS) continue;
    await deleteBlob(file.name);
    deleted++;
  }
  return deleted;
}

/**
 * Deletes files after the rows were changed. The change is saved already, so a failure is only
 * logged; `deleteOrphanedDownloadFiles` runs after every change and removes what was left.
 */
async function removeFiles(work: () => Promise<unknown>): Promise<void> {
  for (const step of [work, () => deleteOrphanedDownloadFiles()]) {
    try {
      await step();
    } catch (error: unknown) {
      console.warn(
        JSON.stringify({
          scope: 'downloads',
          warning: 'Download files could not be deleted; the next change removes them',
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }
}
