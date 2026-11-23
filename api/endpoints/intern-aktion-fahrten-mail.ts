import { app } from '@azure/functions';
import type { CampflowEvent, CampflowPerson } from '../lib/campflow';
import { CAMPFLOW_EVENT_ID_PATTERN, campflowGetAll, getCampflowEvents } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { fahrtenMails, sendFahrtenMails } from '../lib/fahrten-mail';
import type { FahrtenMailErgebnis } from '../lib/fahrten-mail';
import { ok } from '../lib/pflege-api';
import { errorResponse, readJsonBody } from '../lib/response-utils';
import { getPrincipalFirstName, isPreviewDeployment } from '../lib/staff-auth';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';
import { validateFahrtenMail } from '../lib/validation/fahrten';

/**
 * Tells every driver of the plan by mail who rides with them on Hin- and Rückfahrt. Addresses,
 * names and phone numbers come from CampFlow; the browser only sends the person ids of the plan.
 * Replies go to the leader who sends.
 */
const postFahrtenMail: StaffRequestHandler = async (request, context, principal) => {
  const id = request.params.id ?? '';
  if (!CAMPFLOW_EVENT_ID_PATTERN.test(id)) {
    return errorResponse(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  }
  const input = validateFahrtenMail(await readJsonBody(request));

  let events: CampflowEvent[];
  let persons: CampflowPerson[];
  try {
    [events, persons] = await Promise.all([
      getCampflowEvents(),
      campflowGetAll<CampflowPerson>(`/lists/${encodeURIComponent(id)}/persons`),
    ]);
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }
  const event = events.find((e) => e.id === id);
  if (!event) {
    return errorResponse(404, 'NOT_FOUND', 'Diese Aktion gibt es in CampFlow nicht (mehr).');
  }

  const { mails, ohneAdresse } = fahrtenMails(
    event,
    persons,
    input,
    getPrincipalFirstName(principal)
  );
  if (isPreviewDeployment()) {
    const ergebnis: FahrtenMailErgebnis = {
      gesendet: mails.map((mail) => mail.name),
      ohneAdresse,
      fehlgeschlagen: [],
      vorschau: true,
    };
    return ok(ergebnis);
  }
  const sent = await sendFahrtenMails(
    mails,
    { address: principal.userDetails, name: getPrincipalFirstName(principal) },
    (error) => context.error(error)
  );
  const ergebnis: FahrtenMailErgebnis = { ...sent, ohneAdresse, vorschau: false };
  return ok(ergebnis);
};

export const PostFahrtenMailEndpoint = staffHandler('fahrten-mail', postFahrtenMail);

app.http('internAktionFahrtenMail', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/aktionen/{id}/fahrten-mail',
  handler: PostFahrtenMailEndpoint,
});
