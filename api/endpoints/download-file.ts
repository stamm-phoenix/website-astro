import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { serveDownloadFile } from '../lib/downloads';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const NOT_FOUND = errorResponse(404, 'NOT_FOUND', 'Diese Datei gibt es nicht mehr.');

export async function GetDownloadFileEndpointInternal(
  request: HttpRequest
): Promise<HttpResponseInit> {
  return (await serveDownloadFile(request.params.id ?? '')) ?? NOT_FOUND;
}

export default withErrorHandling(GetDownloadFileEndpointInternal);
