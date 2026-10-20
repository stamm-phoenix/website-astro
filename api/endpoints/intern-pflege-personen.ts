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
import { validatePerson } from '../lib/pflege-validation';
import { withErrorHandling } from '../lib/response-utils';
import {
  createPerson,
  deletePerson,
  getPersonenUebersicht,
  updatePerson,
} from '../lib/personen';

/**
 * Personen (`docs/personen.md`): the leaders' links to CampFlow, Altleitende and others, kept by
 * all logged-in leaders. GET: the list with the Entra group and the CampFlow member list;
 * POST: a new person.
 */
export const PersonenCollectionEndpoint = pflegeHandler(
  'personen',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') return ok(await getPersonenUebersicht());
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const input = validatePerson(await readJsonBody(request));
    return ok({ id: await createPerson(input, principal.userDetails) }, 201);
  }
);

/** PATCH/DELETE: change the loaded version of a person; concurrent changes return 409. */
export const PersonItemEndpoint = pflegeHandler(
  'personen',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    if (request.method === 'DELETE') {
      await deletePerson(id, requireVersion(readIfMatch(request)));
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const input = validatePerson(body);
    await updatePerson(id, input, requireVersion(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

export const PersonenCollection = withErrorHandling(PersonenCollectionEndpoint);
export const PersonItem = withErrorHandling(PersonItemEndpoint);
