import type { HttpRequest } from '@azure/functions';
import { parseId } from '../lib/db';
import {
  createLeitende,
  deleteLeitende,
  getStaffLeitende,
  getTeams,
  removeLeitendePhoto,
  setLeitendePhoto,
  updateLeitende,
} from '../lib/leitende-list';
import { MAX_PHOTO_BYTES, validateLeitende } from '../lib/pflege-validation';
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
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { isJpeg } from '../lib/sharepoint-images';

/** GET: all Leitende with the available teams; POST: create a person. */
export const LeitendeCollectionEndpoint = pflegeHandler(
  'leitende',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') {
      const [items, teams] = await Promise.all([getStaffLeitende(), getTeams()]);
      return ok({ teams, items });
    }
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

    const input = validateLeitende(await readJsonBody(request), await getTeams());
    return ok({ id: await createLeitende(input, principal.userDetails) }, 201);
  }
);

/** PATCH: update a person (optimistic locking via etag); DELETE: remove the person. */
export const LeitendeItemEndpoint = pflegeHandler(
  'leitende',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;

    if (request.method === 'DELETE') {
      await deleteLeitende(id, requireVersion(readIfMatch(request)));
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

    const body = await readJsonBody(request);
    const input = validateLeitende(body, await getTeams());
    await updateLeitende(id, input, requireVersion(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

/** PUT: replace the photo with the JPEG in the body; DELETE: remove the photo. */
export const LeitendePhotoEndpoint = pflegeHandler(
  'leitende-foto',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    // Reject photo changes based on an outdated version of the person
    const etag = readIfMatch(request);

    if (request.method === 'DELETE') {
      await removeLeitendePhoto(id, etag, principal.userDetails);
      return NO_CONTENT;
    }
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_PHOTO_BYTES) {
      return errorResponse(413, 'TOO_LARGE', 'Das Foto ist zu groß (höchstens 2 MB).');
    }
    if (!isJpeg(bytes)) {
      return errorResponse(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
    }
    await setLeitendePhoto(id, bytes, etag, principal.userDetails);
    return ok({ hasImage: true });
  }
);

export const LeitendeCollection = withErrorHandling(LeitendeCollectionEndpoint);
export const LeitendeItem = withErrorHandling(LeitendeItemEndpoint);
export const LeitendePhoto = withErrorHandling(LeitendePhotoEndpoint);
