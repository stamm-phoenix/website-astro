import type { HttpRequest } from '@azure/functions';
import { parseId } from '../lib/db';
import {
  createGruppenstunde,
  deleteGruppenstunde,
  getStaffGruppenstunden,
  updateGruppenstunde,
} from '../lib/gruppenstunden-list';
import { getLeitende } from '../lib/leitende-list';
import { STUFEN, WEEKDAYS, validateGruppenstunde } from '../lib/pflege-validation';
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
import { withErrorHandling } from '../lib/response-utils';

async function list(): Promise<unknown> {
  const [items, leitende] = await Promise.all([getStaffGruppenstunden(), getLeitende()]);

  return {
    stufen: STUFEN,
    weekdays: WEEKDAYS,
    items: items.map((item) => ({
      ...item,
      leitende: leitende
        .filter((l) => l.teams.includes(item.stufe))
        .map((l) => ({ id: l.id, name: l.name, hasImage: l.hasImage })),
    })),
  };
}

/** GET: all Gruppenstunden with the allowed Stufen; POST: create a Gruppenstunde. */
export const GruppenstundenCollectionEndpoint = pflegeHandler(
  'gruppenstunden',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') return ok(await list());
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

    const input = validateGruppenstunde(await readJsonBody(request), STUFEN);
    return ok({ id: await createGruppenstunde(input, principal.userDetails) }, 201);
  }
);

/** PATCH: update a Gruppenstunde (optimistic locking via etag); DELETE: remove it. */
export const GruppenstundeItemEndpoint = pflegeHandler(
  'gruppenstunden',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;

    if (request.method === 'DELETE') {
      await deleteGruppenstunde(id, requireVersion(readIfMatch(request)));
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

    const body = await readJsonBody(request);
    const input = validateGruppenstunde(body, STUFEN);
    await updateGruppenstunde(id, input, requireVersion(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

export const GruppenstundenCollection = withErrorHandling(GruppenstundenCollectionEndpoint);
export const GruppenstundeItem = withErrorHandling(GruppenstundeItemEndpoint);
