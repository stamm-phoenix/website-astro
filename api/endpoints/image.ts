import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { serveLeitendePhoto } from '../lib/leitende-list';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

/** GET: the photo of a person from the Leitende, if there is one. */
export async function GetLeitendeImageInternal(request: HttpRequest): Promise<HttpResponseInit> {
  return (
    (await serveLeitendePhoto(request.params.id ?? '')) ??
    errorResponse(404, 'NOT_FOUND', 'Für diese Person gibt es kein Foto.')
  );
}

export const GetLeitendeImage = withErrorHandling(GetLeitendeImageInternal);

app.http('image', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'leitende/{id}/image',
  handler: GetLeitendeImage,
});
