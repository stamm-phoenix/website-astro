import { validateGruppenstundenHinweis } from '../lib/validation/gruppenstunden-exception';
import { app, type HttpRequest } from '@azure/functions';
import { parseId } from '../lib/db';
import {
  createGruppenstunde,
  deleteGruppenstunde,
  getStaffGruppenstunden,
  updateGruppenstunde,
  updateGruppenstundenHinweis,
} from '../lib/gruppenstunden-list';
import { getLeitende } from '../lib/leitende-list';
import { STUFEN, WEEKDAYS } from '../lib/validation/constants';
import { validateGruppenstunde } from '../lib/validation/content';
import { NOT_FOUND, NO_CONTENT, ok, readEtag, readIfMatch, requireEtag } from '../lib/pflege-api';
import { readJsonBody } from '../lib/response-utils';
import { staffHandler } from '../lib/handler';

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
export const GruppenstundenCollection = staffHandler(
  'gruppenstunden',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') return ok(await list());

    const input = validateGruppenstunde(await readJsonBody(request), STUFEN);
    return ok({ id: await createGruppenstunde(input, principal.userDetails) }, 201);
  }
);

/** PATCH: update a Gruppenstunde (optimistic locking via etag); DELETE: remove it. */
export const GruppenstundeItem = staffHandler(
  'gruppenstunden',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;

    if (request.method === 'DELETE') {
      await deleteGruppenstunde(id, requireEtag(readIfMatch(request)));
      return NO_CONTENT;
    }

    const body = await readJsonBody(request);
    const input = validateGruppenstunde(body, STUFEN);
    await updateGruppenstunde(id, input, requireEtag(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

export const GruppenstundenHinweisEndpoint = staffHandler(
  'gruppenstunden',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    const body = await readJsonBody(request);
    const { exception } = validateGruppenstundenHinweis(body);
    await updateGruppenstundenHinweis(
      id,
      exception,
      requireEtag(readEtag(body)),
      principal.userDetails
    );
    return NO_CONTENT;
  }
);

app.http('internPflegeGruppenstunden', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/gruppenstunden',
  handler: GruppenstundenCollection,
});

app.http('internPflegeGruppenstundenHinweis', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'intern/pflege/gruppenstunden/{id}/hinweis',
  handler: GruppenstundenHinweisEndpoint,
});

app.http('internPflegeGruppenstunde', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/gruppenstunden/{id}',
  handler: GruppenstundeItem,
});
