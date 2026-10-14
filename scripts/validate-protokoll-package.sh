#!/usr/bin/env bash
# Verify the deployable production dependencies, including optional native canvas binaries.
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/.." && pwd)"
package_dir="$(mktemp -d)"
trap 'rm -rf "$package_dir"' EXIT
cp "$repository_root/api/package.json" "$repository_root/api/bun.lock" "$package_dir/"
cp -R "$repository_root/api/dist" "$package_dir/"
cd "$package_dir"
bun install --production --frozen-lockfile --ignore-scripts
node - <<'JS'
const assert = require('node:assert/strict');
const { DOMMatrix } = require('@napi-rs/canvas');
assert.ok(new DOMMatrix());
// Running in the copied package proves the worker resolves production dependencies locally.
(async () => {
  const tests = require('node:child_process').spawnSync(process.execPath, ['--test', 'dist/test/protokoll-text.test.js'], { stdio: 'inherit' });
  assert.equal(tests.status, 0);
})().catch(error => { console.error(error); process.exitCode = 1; });
JS
