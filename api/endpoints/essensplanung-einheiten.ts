import { einheitenUebernehmen } from '../lib/essen-einheiten';
import { validateEinheiten } from '../lib/essen-einheiten-schema';
import { ladeAnsicht } from '../lib/essen-planung';
import {
  METHOD_NOT_ALLOWED,
  ok,
  planungHandler,
  readId,
  zugangVon,
} from '../lib/essen-planung-http';
import { readJsonBody } from '../lib/nikolaus-api';

/**
 * PUT `{ zeilen: [{ stelle, id, etag, menge, einheit }, …] }`: the amounts of one ingredient
 * converted into one unit, all or none (`docs/essensplanung.md`, „Einheiten“).
 */
export const EssensplanungZutatEinheiten = planungHandler(async (request) => {
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const id = readId(request);
  const zeilen = validateEinheiten(await readJsonBody(request));
  await einheitenUebernehmen(zugang, id, zeilen);
  return ok(await ladeAnsicht(zugang));
});
