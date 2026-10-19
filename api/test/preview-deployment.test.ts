import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  linkedPlaywrightPr,
  playwrightPreviewUrl,
  setDeploymentValue,
} from '../lib/preview-deployment';

const SOURCE = readFileSync(resolve(__dirname, '../../lib/deployment.ts'), 'utf8');

test('each preview value of deployment.ts is set without touching the others', () => {
  const withDatabase = setDeploymentValue(SOURCE, 'PREVIEW_DATABASE', 'website-pr-7');
  const both = setDeploymentValue(
    withDatabase,
    'PREVIEW_PLAYWRIGHT_API',
    'https://app---pr-3.example.io'
  );
  assert.match(both, /^export const PREVIEW_DATABASE: string \| null = 'website-pr-7';$/m);
  assert.match(both, /^export const PREVIEW_CONTAINER: string \| null = null;$/m);
  assert.match(
    both,
    /^export const PREVIEW_PLAYWRIGHT_API: string \| null = 'https:\/\/app---pr-3\.example\.io';$/m
  );
  assert.equal(setDeploymentValue(both, 'PREVIEW_PLAYWRIGHT_API', null).includes('pr-3'), false);
  assert.throws(() => setDeploymentValue('', 'PREVIEW_DATABASE', 'x'), /missing/);
});

test('a website PR names its playwright-api PR by number or link', () => {
  assert.equal(linkedPlaywrightPr('Braucht playwright-api#12.'), 12);
  assert.equal(linkedPlaywrightPr('Siehe stamm-phoenix/playwright-api#7'), 7);
  assert.equal(linkedPlaywrightPr('(https://github.com/stamm-phoenix/playwright-api/pull/31)'), 31);
  assert.equal(linkedPlaywrightPr('Nur #12 und website-astro#3'), null);
  assert.equal(linkedPlaywrightPr('my-playwright-api#4'), null);
  assert.equal(linkedPlaywrightPr(null), null);
});

test('the preview URL is the label pr-<number> of the same Container App', () => {
  assert.equal(
    playwrightPreviewUrl(
      'https://website-astro-playwright-api.proudfield-37525178.germanywestcentral.azurecontainerapps.io',
      12
    ),
    'https://website-astro-playwright-api---pr-12.proudfield-37525178.germanywestcentral.azurecontainerapps.io'
  );
});
