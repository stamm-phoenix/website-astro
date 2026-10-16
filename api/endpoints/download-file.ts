import type { HttpRequest, InvocationContext, HttpResponseInit } from '@azure/functions';
import {
  downloadsTakenOver,
  readSharePointDownloads,
  sharePointDownloadUrl,
} from '../lib/download-import';
import { serveDownloadFile } from '../lib/downloads';
import {
  encodeContentDisposition,
  errorResponse,
  proxyFile,
  withErrorHandling,
} from '../lib/response-utils';

const NOT_FOUND = errorResponse(404, 'NOT_FOUND', 'Diese Datei gibt es nicht mehr.');

export async function GetDownloadFileEndpointInternal(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const id = request.params.id ?? '';
  if (await downloadsTakenOver()) return (await serveDownloadFile(id)) ?? NOT_FOUND;

  // Still in SharePoint until the takeover is done (`download-import.ts`)
  const file = (await readSharePointDownloads()).find((candidate) => candidate.id === id);
  const url = file && (await sharePointDownloadUrl(file));
  if (!file || !url) return NOT_FOUND;
  return proxyFile(url, context, {
    contentType: file.mimeType || 'application/octet-stream',
    contentDisposition: encodeContentDisposition(file.fileName),
  });
}

export default withErrorHandling(GetDownloadFileEndpointInternal);
