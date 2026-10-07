import type { HttpRequest, HttpResponseInit } from '@azure/functions';
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

export default withNikolausNoStore(LookupNikolausBookingEndpoint);
