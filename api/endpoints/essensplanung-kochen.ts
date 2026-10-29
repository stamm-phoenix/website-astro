import { einplanungAbhaken } from '../lib/essen-kochen';
import { validateAbhaken } from '../lib/essen-kochen-validation';
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
 * Ticking off planned dishes after their meal (`docs/essensplanung.md`, Kochen abhaken), with the
 * token of a link like the other endpoints of a Planung. Answers with the whole view.
 */

/** PUT `{ etag, status, verbrauch: [{ planungZutatId, menge, einheit }] }`. */
export const EssensplanungEinplanungStatus = planungHandler(async (request) => {
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  await einplanungAbhaken(zugang, readId(request), validateAbhaken(body), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});
