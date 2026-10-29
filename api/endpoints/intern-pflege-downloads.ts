import type { HttpRequest, HttpResponseInit } from '@azure/functions';
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
import { requireVersion as parseVersion } from '../lib/db';
import { ValidationError } from '../lib/validation/errors';
import {
  UPLOAD_PART_BYTES,
  validateDownloadRename,
  validateUploadComplete,
  validateUploadStart,
} from '../lib/validation/downloads';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  ok,
  pflegeHandler,
  readEtag,
  readIfMatch,
  readJsonBody,
  requireVersion,
} from '../lib/pflege-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const FILE_EXISTS = errorResponse(409, 'EXISTS', 'Eine Datei mit diesem Namen gibt es bereits.');

const INCOMPLETE = errorResponse(
  409,
  'INCOMPLETE',
  'Die Datei ist nicht vollständig angekommen und wurde nicht gespeichert. Lade sie noch einmal hoch.'
);

function invalid(field: string, message: string): HttpResponseInit {
  return {
    status: 400,
    jsonBody: { error: 'INVALID', code: 'INVALID', message, fields: { [field]: message } },
  };
}

/** The first problem of the request, as the upload dialog shows one message at a time. */
function firstProblem<T>(read: () => T): { value: T } | { response: HttpResponseInit } {
  try {
    return { value: read() };
  } catch (error: unknown) {
    const [first] = error instanceof ValidationError ? Object.entries(error.fields) : [];
    if (!first) throw error;
    return { response: invalid(first[0], first[1]) };
  }
}

/** GET: all download files. */
export const DownloadsCollectionEndpoint = pflegeHandler('downloads', async (request) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;

  const files = await listDownloads();
  return ok(
    files.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      size: file.size,
      mimeType: file.mimeType,
      lastModifiedAt: file.lastModifiedAt,
      lastModifiedBy: file.lastModifiedBy,
      hasPreview: file.hasPreview,
      etag: file.etag,
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
    const parsed = firstProblem(() => validateUploadStart(body));
    if ('response' in parsed) return parsed.response;
    const { fileName, replace } = parsed.value;
    if (!replace && (await downloadNameExists(fileName))) return FILE_EXISTS;

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
    const parsed = firstProblem(() => validateUploadComplete(body));
    if ('response' in parsed) return parsed.response;
    const { fileName, size, replace, preview } = parsed.value;

    const result = await completeUpload(
      { key, fileName, size, replace, preview },
      principal.userDetails
    );
    if (result.status === 'exists') return FILE_EXISTS;
    if (result.status === 'incomplete') return INCOMPLETE;
    return ok({ id: result.id }, 201);
  }
);

/**
 * PATCH: rename a file (`etag` in the body); DELETE: delete it with its previews (`If-Match`).
 * Both only in the loaded version, so a file replaced in the meantime is never hit.
 */
export const DownloadItemEndpoint = pflegeHandler(
  'downloads',
  async (request: HttpRequest, _context, principal) => {
    const id = request.params.id ?? '';
    if (request.method !== 'DELETE' && request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

    if (request.method === 'DELETE') {
      await deleteDownload(id, parseVersion(requireVersion(readIfMatch(request))));
      return NO_CONTENT;
    }

    const body = await readJsonBody(request);
    const named = firstProblem(() => validateDownloadRename(body));
    if ('response' in named) return named.response;
    const fileName = named.value;
    const version = parseVersion(requireVersion(readEtag(body)));
    if (!(await renameDownload(id, fileName, version, principal.userDetails))) return FILE_EXISTS;
    return NO_CONTENT;
  }
);

export const DownloadsCollection = withErrorHandling(DownloadsCollectionEndpoint);
export const DownloadUploadStart = withErrorHandling(DownloadUploadStartEndpoint);
export const DownloadUploadPart = withErrorHandling(DownloadUploadPartEndpoint);
export const DownloadUploadComplete = withErrorHandling(DownloadUploadCompleteEndpoint);
export const DownloadItem = withErrorHandling(DownloadItemEndpoint);
