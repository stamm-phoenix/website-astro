import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import {
  NO_STORE_HEADERS,
  isErrorResponse,
  loadAuthorizedBooking,
  toPublicBookingInfo,
} from '../lib/nikolaus-api';
import { withErrorHandling } from '../lib/response-utils';

export async function GetNikolausBookingEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const result = await loadAuthorizedBooking(request, request.query.get('token'));
  if (isErrorResponse(result)) return result;

  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: toPublicBookingInfo(result.booking),
  };
}

export default withErrorHandling(GetNikolausBookingEndpoint);
