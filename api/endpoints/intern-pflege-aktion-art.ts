import { app, type HttpRequest } from '@azure/functions';
import { getAktionArt, setKeineAktion } from '../lib/aktion-art';
import { CAMPFLOW_EVENT_ID_PATTERN, getCampflowEvents } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { NOT_FOUND, ok } from '../lib/pflege-api';
import { validateKeineAktion } from '../lib/validation/aktion-art';
import { errorResponse, readJsonBody } from '../lib/response-utils';
import { staffHandler } from '../lib/handler';

/**
 * PUT `{ keineAktion }`: whether a CampFlow event is no real Aktion, e.g. an order of jumpers.
 * Only events that exist in CampFlow can be marked; marking with the current value is fine. The
 * answer holds both marks, as taking the mark back brings the stored KJR choice back.
 */
export const AktionArtEndpoint = staffHandler(
  'aktionen-art',
  async (request: HttpRequest, _context, principal) => {
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

export default AktionArtEndpoint;

app.http('internPflegeAktionArt', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aktionen-art/{id}',
  handler: AktionArtEndpoint,
});
