import { app } from '@azure/functions';
import { ladeAnsicht } from '../lib/essen-ansicht';
import { readPosition } from '../lib/essen-planung-validation';
import { gerichtAendern, gerichtAnlegen, gerichtLoeschen } from '../lib/essen-gericht';
import {
  eigeneZutatAnlegen,
  ladeKatalog,
  planungZutatAendern,
  planungZutatLoeschen,
} from '../lib/essen-gerichte';
import {
  gerichtZutatAendern,
  gerichtZutatAnlegen,
  gerichtZutatLoeschen,
  readPersonen,
} from '../lib/essen-gericht-zeilen';
import {
  validateGericht,
  validateNeuesGericht,
  validateGerichtZutat,
  validatePlanungZutat,
} from '../lib/essen-gerichte-validation';
import { ok, planungHandler, readEtag, readId, zugangVon } from '../lib/essen-planung-http';
import { readJsonBody } from '../lib/response-utils';

/** GET: the central lists (categories, allergens, ingredients) the dishes pick from. */
export const EssensplanungKatalog = planungHandler(async (request) => {
  await zugangVon(request);
  return ok(await ladeKatalog());
});

/** POST `{ name, kategorieId, einheitenart, vegetarisch?, vegan?, allergene? }`: an own ingredient. */
export const EssensplanungZutaten = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = await eigeneZutatAnlegen(
    zugang,
    validatePlanungZutat(await readJsonBody(request), { eigene: true })
  );
  return ok({ id, ansicht: await ladeAnsicht(zugang) }, 201);
});

/**
 * PATCH `{ etag, … }`: all fields of an own ingredient, or `{ kategorieId, einheitenart }` as the
 * differences of a central one (null: as in the list). DELETE (If-Match): only while unused.
 */
export const EssensplanungZutat = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await planungZutatLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  const body = await readJsonBody(request);
  await planungZutatAendern(zugang, id, body, readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/**
 * POST `{ name, personen?, …, mahlzeitId?, faktor?, zustaendigId?, zustaendigText? }`: adds a
 * dish, with `mahlzeitId` planned at that meal in the same change; answers with its id and the
 * view.
 */
export const EssensplanungGerichte = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const { gericht, einplanung } = validateNeuesGericht(await readJsonBody(request));
  const id = await gerichtAnlegen(zugang, gericht, einplanung);
  return ok({ id, ansicht: await ladeAnsicht(zugang) }, 201);
});

/** PATCH `{ etag, …changed fields }`: changes a dish. DELETE (If-Match): with its lines. */
export const EssensplanungGericht = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await gerichtLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  const body = await readJsonBody(request);
  await gerichtAendern(zugang, id, validateGericht(body, { neu: false }), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ zutatId | planungZutatId, menge, einheit, …, position? }`: adds a line to a dish. */
export const EssensplanungGerichtZutaten = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  await gerichtZutatAnlegen(
    zugang,
    readId(request),
    validateGerichtZutat(body),
    readPosition(body?.position)
  );
  return ok(await ladeAnsicht(zugang), 201);
});

/**
 * PATCH `{ etag, …the whole line, position?, personen? }`: changes or moves a line; `personen`
 * (a proposal of the AI) must still be the dish's. DELETE (If-Match).
 */
export const EssensplanungGerichtZutat = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await gerichtZutatLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  const body = await readJsonBody(request);
  await gerichtZutatAendern(
    zugang,
    id,
    { ...validateGerichtZutat(body), position: readPosition(body?.position) },
    readEtag(body, request),
    readPersonen(body)
  );
  return ok(await ladeAnsicht(zugang));
});

app.http('essensplanungKatalog', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/katalog',
  handler: EssensplanungKatalog,
});

app.http('essensplanungZutaten', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/zutaten',
  handler: EssensplanungZutaten,
});

app.http('essensplanungZutat', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/zutaten/{id}',
  handler: EssensplanungZutat,
});

app.http('essensplanungGerichte', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte',
  handler: EssensplanungGerichte,
});

app.http('essensplanungGericht', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte/{id}',
  handler: EssensplanungGericht,
});

app.http('essensplanungGerichtZutaten', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte/{id}/zutaten',
  handler: EssensplanungGerichtZutaten,
});

app.http('essensplanungGerichtZutat', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gericht-zutaten/{id}',
  handler: EssensplanungGerichtZutat,
});
