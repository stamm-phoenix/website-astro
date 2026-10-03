/**
 * First step of the content refresh (`.github/workflows/content-refresh.yml`): compares the
 * content of the live API with the version baked into the deployed site and tells the workflow
 * whether a content build is needed (`build`) and which commit to build (`commit`, the one that
 * is deployed, so a content build never ships code that was not deployed before).
 * Run with `bun scripts/content-check.ts` in `web/`; `--force` skips the comparison.
 *
 * A build is needed when the content differs, when the deployed site lacks content or was not
 * built from the live API, or when its build is older than a day (past Aktionen drop out).
 */
import { appendFileSync } from 'node:fs';
import {
  CONTENT_SOURCE_NAMES,
  CONTENT_SOURCES,
  type ContentSourceName,
  type ContentVersion,
  combineHashes,
  hashBody,
} from '../src/lib/content/version';

const SITE_URL = (process.env.CONTENT_API_URL ?? 'https://stamm-phoenix.de').replace(/\/$/, '');
const MAX_AGE_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 20_000;

async function get(path: string): Promise<Response> {
  return fetch(`${SITE_URL}${path}`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'stamm-phoenix-website-build' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function readDeployedVersion(): Promise<ContentVersion | null> {
  try {
    const response = await get('/content-version.json');
    return response.ok ? ((await response.json()) as ContentVersion) : null;
  } catch {
    return null;
  }
}

/** Hash of the live content, or null if the API cannot deliver it right now. */
async function computeLiveHash(): Promise<string | null> {
  const hashes: Partial<Record<ContentSourceName, string>> = {};
  for (const name of CONTENT_SOURCE_NAMES) {
    try {
      const response = await get(CONTENT_SOURCES[name]);
      if (!response.ok) throw new Error(`answered with ${response.status}`);
      hashes[name] = hashBody(new Uint8Array(await response.arrayBuffer()));
    } catch (error: unknown) {
      console.warn(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  return combineHashes(hashes);
}

async function decide(
  deployed: ContentVersion | null
): Promise<{ build: boolean; reason: string }> {
  if (process.argv.includes('--force')) return { build: true, reason: 'requested' };
  if (!deployed) return { build: true, reason: 'the deployed site has no content-version.json' };
  if (deployed.source !== 'live') {
    return { build: true, reason: `the deployed site was built from "${deployed.source}"` };
  }
  const missing = CONTENT_SOURCE_NAMES.filter((name) => deployed.sources?.[name] !== 'ok');
  if (missing.length > 0) {
    return { build: true, reason: `the deployed site lacks ${missing.join(', ')}` };
  }
  if (!(Date.now() - Date.parse(deployed.builtAt) < MAX_AGE_MS)) {
    return { build: true, reason: `the last build is from ${deployed.builtAt}` };
  }

  const liveHash = await computeLiveHash();
  // A content build would fail as well; the next check tries again
  if (!liveHash) return { build: false, reason: 'the API cannot deliver all content right now' };
  return liveHash === deployed.hash
    ? { build: false, reason: 'the content is unchanged' }
    : { build: true, reason: 'the content has changed' };
}

const deployed = await readDeployedVersion();
const { build, reason } = await decide(deployed);
// Before the first deploy with this file, the newest commit of main is built
const commit = deployed?.commit && /^[0-9a-f]{40}$/.test(deployed.commit) ? deployed.commit : '';
console.log(`${build ? 'Build' : 'No build'}: ${reason} (deployed commit: ${commit || 'unknown'})`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `build=${build}\ncommit=${commit}\n`);
}
