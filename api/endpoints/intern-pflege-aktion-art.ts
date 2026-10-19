import type { HttpRequest } from '@azure/functions';
import { getAktionArt, setKeineAktion } from '../lib/aktion-art';
import { CAMPFLOW_EVENT_ID_PATTERN, getCampflowEvents } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { METHOD_NOT_ALLOWED, NOT_FOUND, ok, pflegeHandler, readJsonBody } from '../lib/pflege-api';
import { validateKeineAktion } from '../lib/pflege-validation';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

/**
 * PUT `{ keineAktion }`: whether a CampFlow event is no real Aktion, e.g. an order of jumpers.
 * Only events that exist in CampFlow can be marked; marking with the current value is fine. The
 * answer holds both marks, as taking the mark back brings the stored KJR choice back.
 */
export const AktionArtEndpoint = pflegeHandler(
  'aktionen-art',
  async (request: HttpRequest, _context, principal) => {
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const id = request.params.id ?? '';
    if (!CAMPFLOW_EVENT_ID_PATTERN.test(id)) return NOT_FOUND;

    const keineAktion = validateKeineAktion(await readJsonBody(request));

    try {
      const events = await getCampflowEvents();
      if (!events.some((event) => event.id === id)) {
        return errorResponse(404, 'NOT_FOUND', 'Diese Aktion gibt es in CampFlow nicht (mehr).');
      }
    } catch (error: unknown) {
      return campflowErrorResponse(error);
    }

    await setKeineAktion(id, keineAktion, principal.userDetails);
    return ok(await getAktionArt(id));
  }
);

export default withErrorHandling(AktionArtEndpoint);
