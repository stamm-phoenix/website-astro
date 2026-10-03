import { createHash } from 'node:crypto';

/**
 * Version of the baked content: one hash over the raw responses of the public list endpoints.
 * The build writes it to `/content-version.json`; `scripts/content-check.ts` computes it from
 * the live API every hour and starts a content build when it differs. Images and blog texts are
 * not part of it; they change through the Pflege forms, which trigger a build themselves.
 */

/**
 * Public list endpoints baked into the site. Nikolaus stays live; `/api/leitende` is not shown
 * on any public page (the photos come with Gruppenstunden and Vorstand).
 */
export const CONTENT_SOURCES = {
  gruppenstunden: '/api/gruppenstunden',
  vorstand: '/api/vorstand',
  aktionen: '/api/aktionen',
  blog: '/api/blog',
  downloads: '/api/downloads',
  qa: '/api/qa',
  instagram: '/api/instagram',
} as const;

export type ContentSourceName = keyof typeof CONTENT_SOURCES;

export const CONTENT_SOURCE_NAMES = Object.keys(CONTENT_SOURCES) as ContentSourceName[];

/** Contents of `/content-version.json`. */
export interface ContentVersion {
  /** Combined hash; only meaningful if every source is `ok` */
  hash: string;
  sources: Record<ContentSourceName, 'ok' | 'missing'>;
  /** Where the data came from: `live`, `mock` or `none` */
  source: string;
  /** ISO timestamp of the build */
  builtAt: string;
  /** Commit the site was built from; content builds rebuild exactly this commit */
  commit: string | null;
}

export function hashBody(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

/** Combines the hashes per source; missing sources count as empty. */
export function combineHashes(hashes: Partial<Record<ContentSourceName, string>>): string {
  const lines = CONTENT_SOURCE_NAMES.map((name) => `${name}:${hashes[name] ?? ''}`);
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}
