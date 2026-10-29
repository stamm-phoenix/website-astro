import type { HttpRequest } from '@azure/functions';
import { setZuschussfaehig } from '../lib/aktion-zuschuss';
import { CAMPFLOW_EVENT_ID_PATTERN, getCampflowEvents } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { METHOD_NOT_ALLOWED, NOT_FOUND, ok, pflegeHandler, readJsonBody } from '../lib/pflege-api';
import { validateAktionZuschuss } from '../lib/validation/aktion-art';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

/**
 * PUT `{ zuschussfaehig }`: whether the KJR grant is applied for a CampFlow Aktion. Only
 * Aktionen that exist in CampFlow can be switched; switching to the current value is fine.
 */
export const AktionZuschussEndpoint = pflegeHandler(
  'aktionen-zuschuss',
  async (request: HttpRequest, _context, principal) => {
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const id = request.params.id ?? '';
    if (!CAMPFLOW_EVENT_ID_PATTERN.test(id)) return NOT_FOUND;

    const zuschussfaehig = validateAktionZuschuss(await readJsonBody(request));

    try {
      const events = await getCampflowEvents();
      if (!events.some((event) => event.id === id)) {
        return errorResponse(404, 'NOT_FOUND', 'Diese Aktion gibt es in CampFlow nicht (mehr).');
      }
    } catch (error: unknown) {
      return campflowErrorResponse(error);
    }

    await setZuschussfaehig(id, zuschussfaehig, principal.userDetails);
    return ok({ zuschussfaehig });
  }
);

export default withErrorHandling(AktionZuschussEndpoint);
