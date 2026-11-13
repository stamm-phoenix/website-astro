import { app, type HttpRequest } from '@azure/functions';
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
import { MAX_PHOTO_BYTES } from '../lib/validation/constants';
import { validateLeitende } from '../lib/validation/content';
import { NOT_FOUND, NO_CONTENT, ok, readEtag, readIfMatch, requireEtag } from '../lib/pflege-api';
import { errorResponse, readJsonBody } from '../lib/response-utils';
import { isJpeg } from '../lib/jpeg';
import { staffHandler } from '../lib/handler';

/** GET: all Leitende with the available teams; POST: create a person. */
export const LeitendeCollection = staffHandler(
  'leitende',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') {
      const [items, teams] = await Promise.all([getStaffLeitende(), getTeams()]);
      return ok({ teams, items });
    }

    const input = validateLeitende(await readJsonBody(request), await getTeams());
    return ok({ id: await createLeitende(input, principal.userDetails) }, 201);
  }
);

/** PATCH: update a person (optimistic locking via etag); DELETE: remove the person. */
export const LeitendeItem = staffHandler(
  'leitende',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;

    if (request.method === 'DELETE') {
      await deleteLeitende(id, requireEtag(readIfMatch(request)));
      return NO_CONTENT;
    }

    const body = await readJsonBody(request);
    const input = validateLeitende(body, await getTeams());
    await updateLeitende(id, input, requireEtag(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

/** PUT: replace the photo with the JPEG in the body; DELETE: remove the photo. */
export const LeitendePhoto = staffHandler(
  'leitende-foto',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    // Reject photo changes based on an outdated version of the person
    const etag = readIfMatch(request);

    if (request.method === 'DELETE') {
      const version = await removeLeitendePhoto(id, etag, principal.userDetails);
      return ok({ hasImage: false, etag: version });
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_PHOTO_BYTES) {
      return errorResponse(413, 'TOO_LARGE', 'Das Foto ist zu groß (höchstens 2 MB).');
    }
    if (!isJpeg(bytes)) {
      return errorResponse(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
    }
    const version = await setLeitendePhoto(id, bytes, etag, principal.userDetails);
    return ok({ hasImage: true, etag: version });
  }
);

app.http('internPflegeLeitende', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/leitende',
  handler: LeitendeCollection,
});

app.http('internPflegeLeitendeItem', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/leitende/{id}',
  handler: LeitendeItem,
});

app.http('internPflegeLeitendeFoto', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/leitende/{id}/foto',
  handler: LeitendePhoto,
});
