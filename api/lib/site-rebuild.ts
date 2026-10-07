import type { InvocationContext } from '@azure/functions';

/**
 * Starts a content build of the website after a change in the Pflege forms: the public pages
 * contain the content baked at build time (see `web/src/lib/content/`). The content refresh in
 * the GitHub workflow `azure-static-web-apps-zealous-water-04f606303.yml` reacts to the
 * `content-changed` dispatch; several changes in a row end up in one build there. Without `GITHUB_REBUILD_TOKEN` nothing happens, and the hourly check
 * of that workflow picks the change up instead.
 */

const DISPATCH_URL = 'https://api.github.com/repos/stamm-phoenix/website-astro/dispatches';
const TIMEOUT_MS = 5_000;

/** Pflege areas whose changes appear on the public pages. */
export const PUBLIC_CONTENT_AREAS: ReadonlySet<string> = new Set([
  'aktionen',
  'blog',
  'blog-bilder',
  'downloads',
  'downloads-upload',
  'faq',
  'gruppenstunden',
  'leitende',
  'leitende-foto',
  // Steuerung of the Nikolausdienst, only when something public changed
  'nikolaus',
]);

/** Asks GitHub for a content build; never fails the change that triggered it. */
export async function requestSiteRebuild(area: string, context: InvocationContext): Promise<void> {
  if (!PUBLIC_CONTENT_AREAS.has(area)) return;
  const token = process.env.GITHUB_REBUILD_TOKEN;
  if (!token) {
    context.log(`[rebuild] GITHUB_REBUILD_TOKEN is not set; ${area} appears with the next build`);
    return;
  }
  try {
    const response = await fetch(DISPATCH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'stamm-phoenix-website-api',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ event_type: 'content-changed', client_payload: { area } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      context.warn(`[rebuild] GitHub refused the content build for ${area}: ${response.status}`);
      return;
    }
    context.log(`[rebuild] Content build requested after a change in ${area}`);
  } catch (error: unknown) {
    context.warn(
      `[rebuild] Requesting the content build for ${area} failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
