import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { PreviewSize } from '../lib/downloads';
import { serveDownloadPreview } from '../lib/downloads';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const NOT_FOUND = errorResponse(404, 'NOT_FOUND', 'Für diese Datei gibt es keine Vorschau.');

/** Older pages still ask for `medium`; it gets the large preview. */
const SIZES = new Map<string, PreviewSize>([
  ['small', 'small'],
  ['medium', 'large'],
  ['large', 'large'],
]);

export async function GetDownloadFileImageEndpointInternal(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const size = SIZES.get(request.params.size ?? '');
  if (!size) {
    return { status: 400, body: 'Parameter size must be one of: large, medium, small' };
  }
  return (await serveDownloadPreview(request.params.id ?? '', size)) ?? NOT_FOUND;
}

export default withErrorHandling(GetDownloadFileImageEndpointInternal);
