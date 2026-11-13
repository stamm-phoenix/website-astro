import { app } from '@azure/functions';
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
  validateZuteilungAenderung,
} from '../lib/essen-packliste-validation';
import { zuteilungAbhaken } from '../lib/essen-packliste-zuteilung';
import { ladeAnsicht } from '../lib/essen-ansicht';
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

/** POST `{ name, mitglieder?, namen? }`: adds an entry of its own with who packs it. */
export const EssensplanungPackliste = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  await packEintragAnlegen(zugang, validatePackEintrag(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang), 201);
});

/**
 * PATCH `{ etag, gepackt?, mitglieder?, namen?, weg? }`: packs an entry (on the version `etag`),
 * or adds members and free names and takes off persons (ids in `weg`), which needs no version.
 * DELETE (If-Match): takes an entry of its own off the list.
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
  const aenderung = validatePackAenderung(body);
  const etag = aenderung.gepackt !== undefined ? readEtag(body, request) : null;
  await packEintragAendern(zugang, id, aenderung, etag);
  return ok(await ladeAnsicht(zugang));
});

/** PATCH `{ etag, gepackt }`: packs or unpacks one person's share of an entry. */
export const EssensplanungPackZuteilung = planungHandler(async (request) => {
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const id = readId(request);
  const body = await readJsonBody(request);
  const { gepackt } = validateZuteilungAenderung(body);
  await zuteilungAbhaken(zugang, id, gepackt, readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/**
 * PUT `{ werkzeug, etag, gepackt?, mitglieder?, namen?, weg? }`: the state of a tool of the
 * planned dishes, changed like an entry; `etag` null while nothing is stored for it yet.
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

app.http('essensplanungPackliste', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/packliste',
  handler: EssensplanungPackliste,
});

app.http('essensplanungPackWerkzeug', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/packliste/werkzeug',
  handler: EssensplanungPackWerkzeug,
});

app.http('essensplanungPackZuteilung', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/packliste/zuteilung/{id}',
  handler: EssensplanungPackZuteilung,
});

app.http('essensplanungPackEintrag', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/packliste/{id}',
  handler: EssensplanungPackEintrag,
});
