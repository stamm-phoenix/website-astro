import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { isUploader as isOwner, mayEditBeleg, seesAllBelege } from '../lib/beleg-rechte';
import { parseId } from '../lib/db';
import { isPhotos, readPhotos } from '../lib/validation/beleg-upload';
import { NOT_FOUND, ok, readIfMatch, requireEtag } from '../lib/pflege-api';
import { encodeContentDisposition, NO_STORE_HEADERS, readJsonBody } from '../lib/response-utils';
import { downloadFileName, getBeleg, setBelegPhoto } from '../lib/beleg-list';
import { readBelegPhoto } from '../lib/beleg-photos';
import { staffHandler } from '../lib/handler';
import {
  ACCEPTED,
  FORBIDDEN,
  PRIVATE_CACHE_HEADERS,
  isAuslageOf,
  ownNames,
  startCheck,
} from '../lib/belege-http';

/**
 * GET: the photo (`?thumb=1` as preview, `?original=1` for the unedited photo, `?download=1`
 * as file); PUT: replace it with `photo` and the optional `original` of the JSON body.
 */
export const BelegPhoto = staffHandler(
  'belege-foto',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;

    const beleg = await getBeleg(id);
    if (!beleg) return NOT_FOUND;
    if (!seesAllBelege(principal) && !isOwner(beleg, principal)) {
      // Who laid out the money may look at the photo, not change it
      if (request.method !== 'GET' || !isAuslageOf(beleg, await ownNames(principal))) {
        return NOT_FOUND;
      }
    }

    if (request.method === 'GET') {
      if (!beleg.photo) return NOT_FOUND;
      if (request.query.get('thumb')) {
        const thumbnail = await readBelegPhoto(id, beleg.photo, 'thumb');
        if (!thumbnail) return NOT_FOUND;
        return {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'X-Content-Type-Options': 'nosniff',
            ...PRIVATE_CACHE_HEADERS,
          },
          body: new Uint8Array(thumbnail),
        };
      }
      const original = request.query.get('original');
      const download = request.query.get('download');
      // A PDF is downloaded as such; shown, it is the picture of its first page
      const pdf = beleg.isPdf && !original && download;
      const bytes = await readBelegPhoto(
        id,
        beleg.photo,
        original ? 'original' : pdf ? 'file' : 'photo'
      );
      if (!bytes) return NOT_FOUND;
      const headers: Record<string, string> = {
        ...NO_STORE_HEADERS,
        'Content-Type': pdf ? 'application/pdf' : 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
      };
      if (download) {
        headers['Content-Disposition'] = encodeContentDisposition(
          downloadFileName(beleg, Boolean(original))
        );
      }
      return { status: 200, headers, body: new Uint8Array(bytes) };
    }
    if (!mayEditBeleg(beleg, principal)) {
      return beleg.status === 'Angenommen' ? ACCEPTED : FORBIDDEN;
    }

    // Reject photo changes based on an outdated version of the receipt
    const etag = requireEtag(readIfMatch(request));
    const photos = readPhotos(await readJsonBody(request));
    if (!isPhotos(photos)) return photos;

    const check = startCheck(photos, context);
    return ok(await setBelegPhoto(id, photos, etag, check, principal.userDetails));
  }
);

app.http('internPflegeBelegFoto', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/{id}/foto',
  handler: BelegPhoto,
});
