import type { HttpRequest, InvocationContext, HttpResponseInit } from '@azure/functions';
import { downloadsTakenOver, readSharePointDownloads } from '../lib/download-import';
import type { PreviewSize } from '../lib/downloads';
import { serveDownloadPreview } from '../lib/downloads';
import { errorResponse, proxyFile, withErrorHandling } from '../lib/response-utils';

const NOT_FOUND = errorResponse(404, 'NOT_FOUND', 'Für diese Datei gibt es keine Vorschau.');

/** Older pages still ask for `medium`; it gets the large preview. */
const SIZES: Record<string, PreviewSize> = { small: 'small', medium: 'large', large: 'large' };

export async function GetDownloadFileImageEndpointInternal(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const id = request.params.id ?? '';
  const size = SIZES[request.params.size ?? ''];
  if (!size) {
    return { status: 400, body: 'Parameter size must be one of: large, medium, small' };
  }
  if (await downloadsTakenOver()) return (await serveDownloadPreview(id, size)) ?? NOT_FOUND;

  // Still in SharePoint until the takeover is done (`download-import.ts`)
  const file = (await readSharePointDownloads()).find((candidate) => candidate.id === id);
  const url = file?.thumbnails?.[size];
  if (!url) return NOT_FOUND;
  return proxyFile(url, context, { contentType: 'image/jpeg' });
}

export default withErrorHandling(GetDownloadFileImageEndpointInternal);
