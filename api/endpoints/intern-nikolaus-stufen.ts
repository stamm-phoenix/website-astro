import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { campflowErrorResponse } from '../lib/campflow-api';
import { getLeitende } from '../lib/leitende-list';
import {
  getAllBookings,
  getBooking,
  isBlocking,
  setBookingRejectedStufen,
  setBookingTags,
} from '../lib/nikolaus-bookings';
import { getHelper, getHelpers, updateHelperStufen } from '../lib/nikolaus-helfende-list';
import { buildSuggestions, getStufenMembers, hasTag, withTag } from '../lib/nikolaus-stufen';
import { ValidationError, validateStufenDecision } from '../lib/pflege-validation';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  NO_STORE_HEADERS,
  pflegeHandler,
  readJsonBody,
} from '../lib/pflege-api';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { withErrorHandling } from '../lib/response-utils';

/** GET: open suggestions of the Stufen-Abgleich (CampFlow member list and Leitende list). */
export async function GetInternNikolausStufenEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const now = new Date();
  try {
    const [bookings, helpers, leitende, members] = await Promise.all([
      getAllBookings(),
      getHelpers(),
      getLeitende(),
      getStufenMembers(now),
    ]);
    return {
      status: 200,
      headers: NO_STORE_HEADERS,
      jsonBody: {
        suggestions: buildSuggestions({
          bookings: bookings.filter((b) => isBlocking(b, now)),
          helpers,
          members,
          leitende,
        }),
      },
    };
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }
}

/**
 * POST: accepts a suggestion (adds the Stufe as booking tag or negative helper tag) or rejects
 * it, so it is not suggested again. The entry is read fresh, so other tags are kept.
 */
export const NikolausStufenDecision = pflegeHandler(
  'nikolaus-stufen',
  async (request: HttpRequest) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const { kind, targetId, stufe, decision } = validateStufenDecision(await readJsonBody(request));

    if (kind === 'booking') {
      const booking = await getBooking(targetId);
      if (!booking) return NOT_FOUND;
      if (decision === 'accept') {
        await setBookingTags(targetId, withTag(booking.internalTags, stufe));
      } else {
        await setBookingRejectedStufen(targetId, withTag(booking.rejectedStufen, stufe));
      }
      return NO_CONTENT;
    }

    const helper = await getHelper(targetId);
    if (!helper) return NOT_FOUND;
    if (decision === 'accept') {
      if (hasTag(helper.positiveTags, stufe)) {
        throw new ValidationError({
          stufe: `${stufe} ist bei ${helper.name} schon ein positives Tag.`,
        });
      }
      await updateHelperStufen(
        targetId,
        { negativeTags: withTag(helper.negativeTags, stufe) },
        helper.etag
      );
    } else {
      await updateHelperStufen(
        targetId,
        { rejectedStufen: withTag(helper.rejectedStufen, stufe) },
        helper.etag
      );
    }
    return NO_CONTENT;
  }
);

export const NikolausStufen = withErrorHandling(GetInternNikolausStufenEndpoint);
export const NikolausStufenDecisionEndpoint = withErrorHandling(NikolausStufenDecision);
