import { app, type HttpRequest } from '@azure/functions';
import { parseId } from '../lib/db';
import { NOT_FOUND, NO_CONTENT, ok, readEtag, readIfMatch, requireEtag } from '../lib/pflege-api';
import { readJsonBody } from '../lib/response-utils';
import {
  createInventarArtikel,
  deleteInventarArtikel,
  getInventar,
  updateInventarArtikel,
  zaehleInventarArtikel,
} from '../lib/inventur';
import { validateInventarArtikel, validateInventarZaehlung } from '../lib/validation/inventur';
import { staffHandler } from '../lib/handler';

/** Inventur (#107): GET lists the articles with their variants, POST creates one. */
export const InventurCollection = staffHandler(
  'inventur',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') return ok(await getInventar());
    const input = validateInventarArtikel(await readJsonBody(request));
    return ok({ id: await createInventarArtikel(input, principal.userDetails) }, 201);
  }
);

/** PATCH/DELETE: change the loaded version of an article; concurrent changes return 409. */
export const InventurItem = staffHandler(
  'inventur',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    if (request.method === 'DELETE') {
      await deleteInventarArtikel(id, requireEtag(readIfMatch(request)));
      return NO_CONTENT;
    }
    const body = await readJsonBody(request);
    const input = validateInventarArtikel(body);
    await updateInventarArtikel(id, input, requireEtag(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

/** POST: saves the count of an article; the time and the counting person are stored with it. */
export const InventurZaehlung = staffHandler(
  'inventur',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    const body = await readJsonBody(request);
    const input = validateInventarZaehlung(body);
    await zaehleInventarArtikel(id, input, requireEtag(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

app.http('internPflegeInventur', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/inventur',
  handler: InventurCollection,
});

app.http('internPflegeInventurArtikel', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/inventur/{id}',
  handler: InventurItem,
});

app.http('internPflegeInventurZaehlung', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/inventur/{id}/zaehlung',
  handler: InventurZaehlung,
});
