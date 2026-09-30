import type { HttpRequest } from '@azure/functions';
import { EnvironmentVariable, getEnvironment } from '../lib/environment';
import {
  createSharePointDriveUploadSession,
  deleteSharePointDriveItem,
  getGraphStatus,
  renameSharePointDriveItem,
  sharePointDriveRootFileExists,
} from '../lib/sharepoint-data-access';
import { getDownloadFiles } from '../lib/download-files-list';
import { MAX_UPLOAD_BYTES, checkFileName } from '../lib/pflege-validation';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  ok,
  pflegeHandler,
  readJsonBody,
} from '../lib/pflege-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const FILE_EXISTS = errorResponse(409, 'EXISTS', 'Eine Datei mit diesem Namen gibt es bereits.');

function driveId(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID);
}

function invalid(field: string, message: string) {
  return {
    status: 400,
    jsonBody: { error: 'INVALID', code: 'INVALID', message, fields: { [field]: message } },
  };
}

/** GET: all download files. */
export const DownloadsCollectionEndpoint = pflegeHandler('downloads', async (request) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;

  const files = await getDownloadFiles();
  return ok(
    files.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      size: file.size,
      mimeType: file.mimeType,
      lastModifiedAt: file.lastModifiedAt,
      lastModifiedBy: file.lastModifiedBy,
      hasPreview: file.thumbnails !== undefined,
    }))
  );
});

/**
 * POST: prepares an upload. Returns a short-lived, pre-authenticated upload URL; the browser
 * sends the file there directly, so large files never pass through the Functions.
 */
export const DownloadUploadEndpoint = pflegeHandler('downloads-upload', async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

  const body = await readJsonBody(request);
  const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : '';
  const nameError = checkFileName(fileName);
  if (nameError) return invalid('fileName', nameError);

  const size = body?.size;
  if (typeof size !== 'number' || size <= 0 || size > MAX_UPLOAD_BYTES) {
    return invalid('size', 'Die Datei ist leer oder größer als 250 MB.');
  }

  const replace = body?.replace === true;
  if (!replace && (await sharePointDriveRootFileExists(driveId(), fileName))) return FILE_EXISTS;

  const uploadUrl = await createSharePointDriveUploadSession(driveId(), fileName, replace);
  return ok({ uploadUrl });
});

/** PATCH: rename a file; DELETE: move it to the recycle bin. */
export const DownloadItemEndpoint = pflegeHandler('downloads', async (request: HttpRequest) => {
  const id = request.params.id ?? '';
  if (!/^[A-Za-z0-9!_-]+$/.test(id)) return NOT_FOUND;

  if (request.method === 'DELETE') {
    await deleteSharePointDriveItem(driveId(), id);
    return NO_CONTENT;
  }
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

  const body = await readJsonBody(request);
  const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : '';
  const nameError = checkFileName(fileName);
  if (nameError) return invalid('fileName', nameError);
  // No pre-check: SharePoint names are case-insensitive, so it would find the file itself on a
  // case-only rename. A real name clash makes Graph answer 409 (nameAlreadyExists).
  try {
    await renameSharePointDriveItem(driveId(), id, fileName);
  } catch (error: unknown) {
    if (getGraphStatus(error) === 409) return FILE_EXISTS;
    throw error;
  }
  return NO_CONTENT;
});

export const DownloadsCollection = withErrorHandling(DownloadsCollectionEndpoint);
export const DownloadUpload = withErrorHandling(DownloadUploadEndpoint);
export const DownloadItem = withErrorHandling(DownloadItemEndpoint);
