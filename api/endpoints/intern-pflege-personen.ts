import type { HttpRequest } from '@azure/functions';
import { parseId } from '../lib/db';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  ok,
  pflegeHandler,
  readEtag,
  readIfMatch,
  readJsonBody,
  requireVersion,
} from '../lib/pflege-api';
import { validateWeiterePerson } from '../lib/pflege-validation';
import { withErrorHandling } from '../lib/response-utils';
import {
  createWeiterePerson,
  deleteWeiterePerson,
  getWeiterePersonen,
  updateWeiterePerson,
} from '../lib/weitere-personen';

/**
 * Weitere Personen (#301): Altleitende and others to pick in the Protokoll-Editor, kept by all
 * logged-in leaders. GET: the whole list; POST: a new person.
 */
export const WeiterePersonenCollectionEndpoint = pflegeHandler(
  'personen',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') return ok(await getWeiterePersonen());
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const input = validateWeiterePerson(await readJsonBody(request));
    return ok({ id: await createWeiterePerson(input, principal.userDetails) }, 201);
  }
);

/** PATCH/DELETE: change the loaded version of a person; concurrent changes return 409. */
export const WeiterePersonItemEndpoint = pflegeHandler(
  'personen',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    if (request.method === 'DELETE') {
      await deleteWeiterePerson(id, requireVersion(readIfMatch(request)));
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const input = validateWeiterePerson(body);
    await updateWeiterePerson(id, input, requireVersion(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

export const WeiterePersonenCollection = withErrorHandling(WeiterePersonenCollectionEndpoint);
export const WeiterePersonItem = withErrorHandling(WeiterePersonItemEndpoint);
