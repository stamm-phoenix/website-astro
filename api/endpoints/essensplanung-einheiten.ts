import { app } from '@azure/functions';
import { einheitenUebernehmen } from '../lib/essen-einheiten';
import { validateEinheiten } from '../lib/essen-einheiten-schema';
import { ladeAnsicht } from '../lib/essen-ansicht';
import { ok, planungHandler, readId, zugangVon } from '../lib/essen-planung-http';
import { readJsonBody } from '../lib/response-utils';

/**
 * PUT `{ zeilen: [{ stelle, id, etag, menge, einheit }, …] }`: the amounts of one ingredient
 * converted into one unit, all or none (`docs/essensplanung.md`, „Einheiten“).
 */
export const EssensplanungZutatEinheiten = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  const zeilen = validateEinheiten(await readJsonBody(request));
  await einheitenUebernehmen(zugang, id, zeilen);
  return ok(await ladeAnsicht(zugang));
});

app.http('essensplanungZutatEinheiten', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/zutaten/{id}/einheiten',
  handler: EssensplanungZutatEinheiten,
});
