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
import { withErrorHandling } from '../lib/response-utils';
import {
  createInventarArtikel,
  deleteInventarArtikel,
  getInventar,
  updateInventarArtikel,
  zaehleInventarArtikel,
} from '../lib/inventur';
import { validateInventarArtikel, validateInventarZaehlung } from '../lib/validation/inventur';

/** Inventur (#107): GET lists the articles with their variants, POST creates one. */
export const InventurCollectionEndpoint = pflegeHandler(
  'inventur',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') return ok(await getInventar());
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const input = validateInventarArtikel(await readJsonBody(request));
    return ok({ id: await createInventarArtikel(input, principal.userDetails) }, 201);
  }
);

/** PATCH/DELETE: change the loaded version of an article; concurrent changes return 409. */
export const InventurItemEndpoint = pflegeHandler(
  'inventur',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    if (request.method === 'DELETE') {
      await deleteInventarArtikel(id, requireVersion(readIfMatch(request)));
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const input = validateInventarArtikel(body);
    await updateInventarArtikel(id, input, requireVersion(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

/** POST: saves the count of an article; the time and the counting person are stored with it. */
export const InventurZaehlungEndpoint = pflegeHandler(
  'inventur',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const input = validateInventarZaehlung(body);
    await zaehleInventarArtikel(id, input, requireVersion(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

export const InventurCollection = withErrorHandling(InventurCollectionEndpoint);
export const InventurItem = withErrorHandling(InventurItemEndpoint);
export const InventurZaehlung = withErrorHandling(InventurZaehlungEndpoint);
