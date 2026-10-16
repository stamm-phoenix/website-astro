import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { continueDownloadTakeover, readSharePointDownloads } from '../lib/download-import';
import {
  completeUpload,
  deleteDownload,
  downloadNameExists,
  isDownloadKey,
  isPartIndex,
  listDownloads,
  newDownloadKey,
  renameDownload,
  stageUploadPart,
} from '../lib/downloads';
import { isJpeg } from '../lib/jpeg';
import {
  MAX_PHOTO_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_PART_BYTES,
  checkFileName,
} from '../lib/pflege-validation';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  NO_STORE_HEADERS,
  ok,
  pflegeHandler,
  readJsonBody,
} from '../lib/pflege-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const FILE_EXISTS = errorResponse(409, 'EXISTS', 'Eine Datei mit diesem Namen gibt es bereits.');

const INCOMPLETE = errorResponse(
  409,
  'INCOMPLETE',
  'Die Datei ist nicht vollständig angekommen und wurde nicht gespeichert. Lade sie noch einmal hoch.'
);

/** Writes wait until the files are copied from SharePoint (`download-import.ts`). */
const MOVING: HttpResponseInit = {
  ...errorResponse(
    503,
    'MOVING',
    'Die Downloads werden gerade in den neuen Speicher übertragen. Es wurde nichts geändert. Versuche es in ein paar Minuten noch einmal.'
  ),
  headers: NO_STORE_HEADERS,
};

function invalid(field: string, message: string): HttpResponseInit {
  return {
    status: 400,
    jsonBody: { error: 'INVALID', code: 'INVALID', message, fields: { [field]: message } },
  };
}

function readFileName(body: Record<string, unknown> | null): string {
  return typeof body?.fileName === 'string' ? body.fileName.trim() : '';
}

/** GET: all download files. */
export const DownloadsCollectionEndpoint = pflegeHandler('downloads', async (request) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;

  const files = (await continueDownloadTakeover())
    ? await listDownloads()
    : await readSharePointDownloads();
  return ok(
    files.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      size: file.size,
      mimeType: file.mimeType,
      lastModifiedAt: file.lastModifiedAt,
      lastModifiedBy: file.lastModifiedBy,
      hasPreview: file.hasPreview,
    }))
  );
});

/**
 * POST: starts an upload. Checks name and size and returns the key under which the browser
 * sends the parts (`DownloadUploadPartEndpoint`) and then completes the upload.
 */
export const DownloadUploadStartEndpoint = pflegeHandler(
  'downloads-upload-start',
  async (request) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

    const body = await readJsonBody(request);
    const fileName = readFileName(body);
    const nameError = checkFileName(fileName);
    if (nameError) return invalid('fileName', nameError);

    const size = body?.size;
    if (typeof size !== 'number' || size <= 0 || size > MAX_UPLOAD_BYTES) {
      return invalid('size', 'Die Datei ist leer oder größer als 250 MB.');
    }
    if (!(await continueDownloadTakeover())) return MOVING;
    if (body?.replace !== true && (await downloadNameExists(fileName))) return FILE_EXISTS;

    return ok({ uploadId: newDownloadKey(), partSize: UPLOAD_PART_BYTES });
  },
  { quiet: true }
);

/** PUT: one part of an upload, `index` counted from 0, each `partSize` bytes but the last. */
export const DownloadUploadPartEndpoint = pflegeHandler(
  'downloads-upload-part',
  async (request: HttpRequest) => {
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const key = request.params.uploadId ?? '';
    const index = Number(request.params.index);
    if (!isDownloadKey(key) || !/^\d+$/.test(request.params.index ?? '') || !isPartIndex(index)) {
      return NOT_FOUND;
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length === 0 || bytes.length > UPLOAD_PART_BYTES) {
      return invalid('file', 'Ein Teil der Datei hat die falsche Größe.');
    }
    await stageUploadPart(key, index, bytes);
    return NO_CONTENT;
  },
  { quiet: true }
);

/**
 * POST: completes an upload with the name of the file and, optionally, a preview image the
 * browser made (`preview`, a JPEG as base64). With `replace`, a file of the same name is
 * replaced and keeps its link.
 */
export const DownloadUploadCompleteEndpoint = pflegeHandler(
  'downloads-upload',
  async (request, _context, principal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const key = request.params.uploadId ?? '';
    if (!isDownloadKey(key)) return NOT_FOUND;

    const body = await readJsonBody(request);
    const fileName = readFileName(body);
    const nameError = checkFileName(fileName);
    if (nameError) return invalid('fileName', nameError);

    let preview: Uint8Array | undefined;
    if (typeof body?.preview === 'string' && body.preview) {
      preview = Buffer.from(body.preview, 'base64');
      if (preview.length > MAX_PHOTO_BYTES || !isJpeg(preview)) {
        return invalid('preview', 'Das Vorschaubild ist kein JPEG oder größer als 2 MB.');
      }
    }
    if (!(await continueDownloadTakeover())) return MOVING;

    const result = await completeUpload(
      { key, fileName, replace: body?.replace === true, preview },
      principal.userDetails
    );
    if (result.status === 'exists') return FILE_EXISTS;
    if (result.status === 'incomplete') return INCOMPLETE;
    return ok({ id: result.id }, 201);
  }
);

/** PATCH: rename a file; DELETE: delete it with its previews. */
export const DownloadItemEndpoint = pflegeHandler(
  'downloads',
  async (request: HttpRequest, _context, principal) => {
    const id = request.params.id ?? '';
    if (request.method !== 'DELETE' && request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
    if (!(await continueDownloadTakeover())) return MOVING;

    if (request.method === 'DELETE') {
      await deleteDownload(id);
      return NO_CONTENT;
    }

    const body = await readJsonBody(request);
    const fileName = readFileName(body);
    const nameError = checkFileName(fileName);
    if (nameError) return invalid('fileName', nameError);
    if (!(await renameDownload(id, fileName, principal.userDetails))) return FILE_EXISTS;
    return NO_CONTENT;
  }
);

export const DownloadsCollection = withErrorHandling(DownloadsCollectionEndpoint);
export const DownloadUploadStart = withErrorHandling(DownloadUploadStartEndpoint);
export const DownloadUploadPart = withErrorHandling(DownloadUploadPartEndpoint);
export const DownloadUploadComplete = withErrorHandling(DownloadUploadCompleteEndpoint);
export const DownloadItem = withErrorHandling(DownloadItemEndpoint);
