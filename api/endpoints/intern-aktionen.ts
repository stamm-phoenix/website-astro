import { app } from '@azure/functions';
import type { AktionArt } from '../lib/aktion-art';
import { withAktionArt } from '../lib/aktion-art';
import { getCampflowEvents } from '../lib/campflow';
import type { CampflowEvent } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { NO_STORE_HEADERS } from '../lib/response-utils';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

/** A CampFlow event with whether it is a real Aktion and gets the KJR grant. */
export interface InternAktion extends CampflowEvent, AktionArt {}

/** All CampFlow events for the Leitendenbereich, with whether they are Aktionen and get the grant. */
const getInternAktionen: StaffRequestHandler = async () => {
  let events: CampflowEvent[];
  try {
    events = await getCampflowEvents();
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }
  const body: InternAktion[] = await withAktionArt(events);
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: body };
};

export const GetInternAktionenEndpoint = staffHandler('aktionen', getInternAktionen);

export default GetInternAktionenEndpoint;

app.http('internAktionen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/aktionen',
  handler: GetInternAktionenEndpoint,
});
