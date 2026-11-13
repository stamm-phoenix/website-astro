import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import type { PreviewSize } from '../lib/downloads';
import { serveDownloadPreview } from '../lib/downloads';
import { errorResponse } from '../lib/response-utils';
import { publicHandler } from '../lib/handler';

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

const GetDownloadFileImageEndpoint = publicHandler(GetDownloadFileImageEndpointInternal);
export default GetDownloadFileImageEndpoint;

app.http('downloadImage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'downloads/{id}/image/{size}',
  handler: GetDownloadFileImageEndpoint,
});
