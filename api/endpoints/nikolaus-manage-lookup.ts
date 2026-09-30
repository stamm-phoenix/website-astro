import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { bookingResponse, isErrorResponse, loadAuthorizedBooking } from '../lib/nikolaus-api';
import { withErrorHandling } from '../lib/response-utils';

export async function LookupNikolausBookingEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const result = await loadAuthorizedBooking(request);
  if (isErrorResponse(result)) return result;

  return bookingResponse(result.booking);
}

export default withErrorHandling(LookupNikolausBookingEndpoint);
