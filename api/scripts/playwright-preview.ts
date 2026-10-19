/**
 * Points the preview of a website PR at the preview of the matching playwright-api PR, so
 * changes in both repositories can be tried together. Runs in the deploy workflow after
 * `db-preview.ts create … --write-deployment`.
 *
 *   bun scripts/playwright-preview.ts <website PR>
 *
 * Reads the description and branch of the website PR from GitHub (GH_TOKEN, GITHUB_REPOSITORY). The matching playwright-api PR is the one named in the description
 * (`playwright-api#12` or its link), else an open one with the same branch name. Without one,
 * or when its preview does not answer, the preview uses the production Playwright API.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG } from '../lib/config';
import {
  linkedPlaywrightPr,
  playwrightPreviewUrl,
  setDeploymentValue,
} from '../lib/preview-deployment';

const REPO = 'stamm-phoenix/playwright-api';
/** A preview scaled to zero needs about 25 seconds to start. */
const HEALTH_TIMEOUT_MS = 120_000;

interface PullRequest {
  number: number;
  state: string;
  html_url: string;
  body: string | null;
  head: { ref: string };
}

async function github<T>(path: string): Promise<T> {
  const token = process.env.GH_TOKEN;
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub ${path}: ${response.status}`);
  return (await response.json()) as T;
}

async function findPr(website: PullRequest): Promise<PullRequest | null> {
  const named = linkedPlaywrightPr(website.body);
  if (named !== null) return github<PullRequest>(`/repos/${REPO}/pulls/${named}`);
  const branch = website.head.ref;
  const owner = REPO.split('/')[0];
  const open = await github<PullRequest[]>(
    `/repos/${REPO}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`
  );
  return open[0] ?? null;
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

async function main(): Promise<void> {
  const [websitePr] = process.argv.slice(2);
  const websiteRepo = process.env.GITHUB_REPOSITORY ?? 'stamm-phoenix/website-astro';
  if (!/^\d+$/.test(websitePr ?? '')) {
    console.error('Usage: bun scripts/playwright-preview.ts <website PR>');
    process.exit(1);
  }
  const pr = await findPr(await github<PullRequest>(`/repos/${websiteRepo}/pulls/${websitePr}`));
  let url: string | null = null;
  if (!pr) {
    report('Playwright API: Produktion (kein passender playwright-api-PR).');
  } else if (pr.state !== 'open') {
    report(`Playwright API: Produktion, ${pr.html_url} ist ${pr.state}.`, 'warning');
  } else {
    const preview = playwrightPreviewUrl(CONFIG.playwrightApi.url, pr.number);
    if (await answers(preview)) {
      url = preview;
      report(`Playwright API: Preview von ${pr.html_url} (${preview}).`);
    } else {
      report(
        `Playwright API: Produktion, die Preview von ${pr.html_url} antwortet nicht (${preview}). Nach deren Deploy diesen Lauf neu starten.`,
        'warning'
      );
    }
  }

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
