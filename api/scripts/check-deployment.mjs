import assert from 'node:assert/strict';
import process from 'node:process';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

/** A preview with missing configuration must stop before upload, never fall back to production. */
export function checkDeployment(values, pr = '') {
  assert.deepEqual(Object.keys(values).sort(), [
    'PREVIEW_CONTAINER',
    'PREVIEW_DATABASE',
    'PREVIEW_PLAYWRIGHT_API',
  ]);
  if (pr) assert.match(pr, /^[1-9]\d{0,5}$/);
  assert.equal(values.PREVIEW_DATABASE, pr ? `website-pr-${pr}` : null);
  assert.equal(values.PREVIEW_CONTAINER, pr ? `pr-${pr}` : null);
  if (pr && values.PREVIEW_PLAYWRIGHT_API !== null) {
    assert.equal(new URL(values.PREVIEW_PLAYWRIGHT_API).protocol, 'https:');
  } else {
    assert.equal(values.PREVIEW_PLAYWRIGHT_API, null);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = resolve(process.argv[2], 'dist/bundle/deployment.js');
  checkDeployment(createRequire(import.meta.url)(file), process.argv[3]);
  log('API deployment configuration verified.');
}
