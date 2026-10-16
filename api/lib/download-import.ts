import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { deleteBlobs, putBlobStream } from './blob-storage';
import { CONFIG } from './config';
import { getDb, getSqlErrorNumber, isDatabaseOverridden } from './db';
import { PREVIEW_DATABASE } from './deployment';
import type { StoredDownload } from './downloads';
import { downloadBlobName, newDownloadKey, storePreviews } from './downloads';
import { downloadMimeType } from './pflege-validation';
import {
  getSharePointDriveItemDownloadUrl,
  getSharePointDriveRootChildren,
} from './sharepoint-data-access';

/**
 * One-time takeover of the download library in SharePoint into Azure SQL and Blob Storage
 * (#165, migration `0027_downloads.sql`). Requests after the deploy copy the files one by one,
 * with their IDs, so shared links keep working; each request copies only for a while, because
 * the Functions of the Static Web App stop after 45 seconds. Until every file is copied, the
 * downloads are still read from SharePoint and cannot be changed; then the takeover is recorded
 * in `content.sharepoint_import` and only Azure SQL and Blob Storage are used. The library in
 * SharePoint is read, never changed. Previews never copy anything: they get invented downloads
 * from `db-preview.ts`.
 */

/** A file of the library in SharePoint. */
export interface SharePointDownload extends StoredDownload {
  downloadUrl?: string;
  /** Pre-authenticated URLs of the thumbnails SharePoint made. */
  thumbnails?: { small: string; large: string };
}

interface DriveItem {
  id: string;
  name: string;
  size: number;
  file?: { mimeType: string };
  '@microsoft.graph.downloadUrl'?: string;
  createdBy?: { user?: { displayName?: string } };
  createdDateTime: string;
  lastModifiedBy?: { user?: { displayName?: string } };
  lastModifiedDateTime: string;
  thumbnails?: Array<{
    large?: { url?: string };
    small?: { url?: string };
  }>;
}

/** Time one request spends copying; the rest of its 45 seconds is left for the answer. */
const COPY_BUDGET_MS = 20_000;
const COPY_CONCURRENCY = 2;

function driveId(): string {
  return CONFIG.sharepoint.downloadFilesDriveId;
}

/** The files in the root folder of the library. */
export async function readSharePointDownloads(): Promise<SharePointDownload[]> {
  const items = (await getSharePointDriveRootChildren(driveId(), {
    expand: 'thumbnails',
  })) as DriveItem[];
  return items
    .filter((item) => item.file)
    .map((item) => {
      const thumbnail = item.thumbnails?.[0];
      const small = thumbnail?.small?.url;
      const large = thumbnail?.large?.url;
      return {
        id: item.id,
        fileName: item.name,
        size: item.size,
        mimeType: item.file?.mimeType ?? 'application/octet-stream',
        hasPreview: small !== undefined && large !== undefined,
        createdAt: item.createdDateTime,
        createdBy: item.createdBy?.user?.displayName ?? 'Unbekannt',
        lastModifiedAt: item.lastModifiedDateTime,
        lastModifiedBy: item.lastModifiedBy?.user?.displayName ?? 'Unbekannt',
        downloadUrl: item['@microsoft.graph.downloadUrl'],
        thumbnails: small && large ? { small, large } : undefined,
      };
    });
}

/** The pre-authenticated download URL of a file; Graph leaves it out of some listings. */
export async function sharePointDownloadUrl(file: SharePointDownload): Promise<string | undefined> {
  return file.downloadUrl ?? (await getSharePointDriveItemDownloadUrl(driveId(), file.id));
}

/**
 * Only the website itself copies, into its configured production database: previews (and the
 * preview server) only ever hold invented data, and scripts and tests that point the pool at
 * another database (`useDatabase`) never copy production data into it.
 */
export function mayImport(): boolean {
  return (
    PREVIEW_DATABASE === null &&
    CONFIG.database.server !== CONFIG.database.previewServer &&
    !isDatabaseOverridden()
  );
}

let takenOver = false;

/** Whether the downloads are in Azure SQL; false while the takeover is still running. */
export async function downloadsTakenOver(): Promise<boolean> {
  if (takenOver) return true;
  if (!mayImport()) return true;
  const row = await getDb()
    .selectFrom('content.sharepoint_import')
    .select('list')
    .where('list', '=', 'downloads')
    .executeTakeFirst();
  takenOver = row !== undefined;
  return takenOver;
}

/**
 * Continues the takeover if it is not done yet. Returns whether the downloads are in Azure SQL
 * now; if not, the caller reads them from SharePoint.
 */
export async function continueDownloadTakeover(): Promise<boolean> {
  if (await downloadsTakenOver()) return true;
  try {
    takenOver = await copyDownloads();
  } catch (error: unknown) {
    // The next request tries again; until then SharePoint stays the source
    console.error(
      JSON.stringify({
        scope: 'download-import',
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
  return takenOver;
}

export interface CopySummary {
  items: number;
  /** Files with a preview; SharePoint has none for some types, others failed (logged). */
  previews: number;
}

/**
 * Copies the files that are not in Azure SQL yet, as long as `budgetMs` allows, and records the
 * takeover once all are there. Returns whether it is complete. Concurrent requests may copy the
 * same file: the one that saves its row first wins, the other deletes its copy.
 */
export async function copyDownloads(
  budgetMs: number = COPY_BUDGET_MS,
  now: () => number = Date.now
): Promise<boolean> {
  const deadline = now() + budgetMs;
  const files = await readSharePointDownloads();
  const existing = new Set(
    (await getDb().selectFrom('content.download').select('id').execute()).map((row) => row.id)
  );
  const queue = files.filter((file) => !existing.has(file.id));
  const worker = async (): Promise<void> => {
    for (let file = queue.shift(); file && now() < deadline; file = queue.shift()) {
      await copyFile(file);
      existing.add(file.id);
    }
  };
  const results = await Promise.allSettled(Array.from({ length: COPY_CONCURRENCY }, worker));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;

  if (files.some((file) => !existing.has(file.id))) return false;
  const rows = await getDb().selectFrom('content.download').select('has_preview').execute();
  const summary: CopySummary = {
    items: rows.length,
    previews: rows.filter((row) => row.has_preview).length,
  };
  try {
    await getDb()
      .insertInto('content.sharepoint_import')
      .values({ list: 'downloads', summary: JSON.stringify(summary) })
      .execute();
  } catch (error: unknown) {
    // Another request recorded it first
    if (![2601, 2627].includes(getSqlErrorNumber(error) ?? 0)) throw error;
  }
  console.log(JSON.stringify({ scope: 'download-import', done: true, ...summary }));
  return true;
}

/** Copies one file with its preview and saves its row, unless another request was faster. */
async function copyFile(file: SharePointDownload): Promise<void> {
  const key = newDownloadKey();
  try {
    const url = await sharePointDownloadUrl(file);
    if (!url) throw new Error(`SharePoint has no download URL for ${file.id}`);
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Download of ${file.id} failed: ${response.status}`);
    }
    await putBlobStream(
      downloadBlobName(key),
      Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
      downloadMimeType(file.fileName)
    );
    const hasPreview = file.thumbnails ? await copyPreview(key, file) : false;
    await getDb()
      .insertInto('content.download')
      .values({
        id: file.id,
        file_name: file.fileName,
        file_key: key,
        size: file.size,
        mime_type: downloadMimeType(file.fileName),
        has_preview: hasPreview,
        created_at: new Date(file.createdAt).toISOString(),
        created_by: file.createdBy,
        updated_at: new Date(file.lastModifiedAt).toISOString(),
        updated_by: file.lastModifiedBy,
      })
      .execute();
  } catch (error: unknown) {
    await deleteBlobs(`downloads/${key}/`).catch(() => undefined);
    if ([2601, 2627].includes(getSqlErrorNumber(error) ?? 0)) return;
    throw error;
  }
}

async function copyPreview(key: string, file: SharePointDownload): Promise<boolean> {
  try {
    const response = await fetch(file.thumbnails!.large);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Thumbnail of ${file.id} failed: ${response.status}`);
    }
    return await storePreviews(key, new Uint8Array(await response.arrayBuffer()));
  } catch (error: unknown) {
    console.warn(
      JSON.stringify({
        scope: 'download-import',
        warning: 'The thumbnail could not be copied; the file is taken over without a preview',
        id: file.id,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return false;
  }
}
