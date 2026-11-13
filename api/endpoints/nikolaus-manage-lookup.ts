import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import {
  bookingResponse,
  isErrorResponse,
  loadAuthorizedBooking,
  withNikolausNoStore,
} from '../lib/nikolaus-api';

export async function LookupNikolausBookingEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const result = await loadAuthorizedBooking(request);
  if (isErrorResponse(result)) return result;

  return bookingResponse(result.booking, result.config);
}

const defaultHandler = withNikolausNoStore(LookupNikolausBookingEndpoint);
export default defaultHandler;

app.http('nikolausManageLookup', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/manage/lookup',
  handler: defaultHandler,
});
