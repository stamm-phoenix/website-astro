/**
 * Reads the parts of a request to a Planung of the Essensplanung that are no form: the version
 * of an entry, a member's role, the shared link and the day a meal belongs to. Used by the
 * endpoint (`endpoints/essensplanung.ts`).
 */
import { z } from 'zod';
import { lenientObject, parseWith } from './validation/zod';

const ETAG = /^(?:W\/)?"[^"\r\n]+"$/;

const VERSION_MISSING = 'Die Version fehlt. Bitte lade die Seite neu.';
const LINK_ART_MISSING = 'Bitte angeben, welcher Link erzeugt oder abgeschaltet wird.';

const etagSchema = z.object({
  etag: z.string({ error: VERSION_MISSING }).regex(ETAG, { error: VERSION_MISSING }),
});

const rolleSchema = lenientObject({
  rolle: z.enum(['besitzer', 'bearbeiten'], { error: 'Bitte eine Rolle wählen.' }),
});

const gemeinsamerLinkSchema = lenientObject({
  art: z.enum(['beitritt', 'lesen'], { error: LINK_ART_MISSING }),
  an: z.boolean({ error: LINK_ART_MISSING }),
});

/** A missing or fractional day ID is 0, which no day has. */
const tagIdSchema = z.number().refine(Number.isInteger).catch(0);

/** The version of the body's `etag`, else of the `If-Match` header. */
export function readEtag(body: Record<string, unknown> | null, ifMatch: string | null): string {
  const etag = (typeof body?.etag === 'string' && body.etag) || ifMatch || '';
  return parseWith(etagSchema, { etag }).etag;
}

/** The new role of a member. */
export function readRolle(body: Record<string, unknown> | null): 'besitzer' | 'bearbeiten' {
  return parseWith(rolleSchema, body).rolle;
}

/** Which shared link is turned on or off; both fields report as `art`. */
export function readGemeinsamerLink(body: Record<string, unknown> | null): {
  art: 'beitritt' | 'lesen';
  an: boolean;
} {
  return parseWith(gemeinsamerLinkSchema, body, () => 'art');
}

export function readTagId(body: Record<string, unknown> | null): number {
  return tagIdSchema.parse(body?.tagId);
}
