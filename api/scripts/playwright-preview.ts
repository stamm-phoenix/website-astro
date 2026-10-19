/**
 * Points the preview of a website PR at the preview of a playwright-api PR, so changes in both
 * repositories can be tried together. Runs in the deploy workflow after
 * `db-preview.ts create … --write-deployment`.
 *
 *   bun scripts/playwright-preview.ts <website PR>
 *
 * Reads the description of the website PR from GitHub (GH_TOKEN, GITHUB_REPOSITORY). The
 * playwright-api PR is the one named there (`playwright-api#12` or its link); playwright-api is
 * private, so this deployment cannot look it up and asks its preview instead. Without one, or
 * when its preview does not answer (not deployed yet, or removed with its closed PR), the
 * preview uses the production Playwright API. Never fails the deploy.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG } from '../lib/config';
import {
  linkedPlaywrightPr,
  playwrightPreviewUrl,
  setDeploymentValue,
} from '../lib/preview-deployment';

/** A preview scaled to zero needs about 25 seconds to start. */
const HEALTH_TIMEOUT_MS = 120_000;

async function description(repo: string, pr: string): Promise<string | null> {
  const token = process.env.GH_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${repo}/pulls/${pr}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub ${repo}#${pr}: ${response.status}`);
  return ((await response.json()) as { body: string | null }).body;
}

async function answers(url: string): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(30_000) });
      if (response.ok) return true;
    } catch {
      // Starting or not deployed (yet); try again
    }
    await new Promise((done) => setTimeout(done, 5_000));
  }
  return false;
}

function report(message: string, level: 'notice' | 'warning' = 'notice'): void {
  console.log(`::${level}::${message}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

/** The preview URL to use, or null for production. */
async function previewUrl(websitePr: string): Promise<string | null> {
  const repo = process.env.GITHUB_REPOSITORY ?? 'stamm-phoenix/website-astro';
  let pr: number | null;
  try {
    pr = linkedPlaywrightPr(await description(repo, websitePr));
  } catch (error: unknown) {
    report(
      `Playwright API: Produktion, die PR-Beschreibung war nicht lesbar (${String(error)}).`,
      'warning'
    );
    return null;
  }
  if (pr === null) {
    report('Playwright API: Produktion (kein playwright-api-PR in der Beschreibung).');
    return null;
  }
  const preview = playwrightPreviewUrl(CONFIG.playwrightApi.url, pr);
  if (await answers(preview)) {
    report(`Playwright API: Preview von playwright-api#${pr} (${preview}).`);
    return preview;
  }
  report(
    `Playwright API: Produktion, die Preview von playwright-api#${pr} antwortet nicht (${preview}). Ist sie deployt, diesen Lauf neu starten.`,
    'warning'
  );
  return null;
}

async function main(): Promise<void> {
  const [websitePr] = process.argv.slice(2);
  if (!/^\d+$/.test(websitePr ?? '')) {
    console.error('Usage: bun scripts/playwright-preview.ts <website PR>');
    process.exit(1);
  }
  const url = await previewUrl(websitePr);
  const file = resolve(__dirname, '../lib/deployment.ts');
  writeFileSync(
    file,
    setDeploymentValue(readFileSync(file, 'utf8'), 'PREVIEW_PLAYWRIGHT_API', url)
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
