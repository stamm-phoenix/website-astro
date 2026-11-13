import { app, type HttpRequest } from '@azure/functions';
import { parseId } from '../lib/db';
import { NOT_FOUND, NO_CONTENT, ok, readEtag, readIfMatch, requireEtag } from '../lib/pflege-api';
import { validatePerson } from '../lib/validation/person';
import { readJsonBody } from '../lib/response-utils';
import { createPerson, deletePerson, getPersonenUebersicht, updatePerson } from '../lib/personen';
import { staffHandler } from '../lib/handler';

/**
 * Personen (`docs/personen.md`): the leaders' links to CampFlow, Altleitende and others, kept by
 * all logged-in leaders. GET: the list with the Entra group and the CampFlow member list;
 * POST: a new person.
 */
export const PersonenCollection = staffHandler(
  'personen',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') return ok(await getPersonenUebersicht());
    const input = validatePerson(await readJsonBody(request));
    return ok({ id: await createPerson(input, principal.userDetails) }, 201);
  }
);

/** PATCH/DELETE: change the loaded version of a person; concurrent changes return 409. */
export const PersonItem = staffHandler(
  'personen',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    if (request.method === 'DELETE') {
      await deletePerson(id, requireEtag(readIfMatch(request)));
      return NO_CONTENT;
    }
    const body = await readJsonBody(request);
    const input = validatePerson(body);
    await updatePerson(id, input, requireEtag(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

app.http('internPflegePersonen', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/personen',
  handler: PersonenCollection,
});

app.http('internPflegePerson', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/personen/{id}',
  handler: PersonItem,
});
