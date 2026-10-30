import {
  packEintragAendern,
  packEintragAnlegen,
  packEintragLoeschen,
  werkzeugSetzen,
} from '../lib/essen-packliste';
import {
  validatePackAenderung,
  validatePackEintrag,
  validateWerkzeugAenderung,
} from '../lib/essen-packliste-validation';
import { ladeAnsicht } from '../lib/essen-planung';
import {
  METHOD_NOT_ALLOWED,
  ok,
  planungHandler,
  readEtag,
  readId,
  zugangVon,
} from '../lib/essen-planung-http';
import { readJsonBody } from '../lib/nikolaus-api';

/**
 * The packing list of a Planung (`docs/essensplanung.md`, Packliste), with the token of a link
 * like the other endpoints of a Planung. Changes answer with the whole view.
 */

/** POST `{ name, zustaendigId?, zustaendigText? }`: adds an entry of its own. */
export const EssensplanungPackliste = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  await packEintragAnlegen(zugang, validatePackEintrag(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang), 201);
});

/**
 * PATCH `{ etag, gepackt?, zustaendigId?, zustaendigText? }`: packs an entry or changes who packs
 * it. DELETE (If-Match): takes an entry of its own off the list.
 */
export const EssensplanungPackEintrag = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await packEintragLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  await packEintragAendern(zugang, id, validatePackAenderung(body), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/**
 * PUT `{ werkzeug, etag, gepackt?, zustaendigId?, zustaendigText? }`: the state of a tool of the
 * planned dishes; `etag` null while nothing is stored for it yet.
 */
export const EssensplanungPackWerkzeug = planungHandler(async (request) => {
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  const aenderung = validateWerkzeugAenderung(body);
  const etag = body?.etag === null || body?.etag === undefined ? null : readEtag(body, request);
  await werkzeugSetzen(zugang, aenderung, etag);
  return ok(await ladeAnsicht(zugang));
});
