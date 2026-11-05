#!/usr/bin/env bash
# Prepare the exact Functions package that SWA uploads without an Oryx rebuild.
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/.." && pwd)"
package_dir="${1:?Pass a new absolute output directory}"
[[ "$package_dir" = /* && ! -e "$package_dir" ]]
cd "$repository_root/api"
test -f dist/bundle/main.js
mkdir -p "$package_dir/dist"
cp -R dist/bundle "$package_dir/dist/"
cp -R assets "$package_dir/"
cp host.json package.json bun.lock "$package_dir/"
cd "$package_dir"
bun install --production --frozen-lockfile --ignore-scripts
# The host must be able to resolve both native image processing and PDF extraction.
node - <<'JS'
const assert = require('node:assert/strict');
assert.ok(require('sharp').versions.vips);
assert.ok(new (require('@napi-rs/canvas').DOMMatrix)());
require('pdfmake');
const { app } = require('@azure/functions');
let registered = 0;
app.http = () => { registered++; };
require('./dist/bundle/main.js');
assert.ok(registered > 100, 'The bundled Functions entry point registers its endpoints');
const deployment = require('./dist/bundle/deployment.js');
assert.deepEqual(Object.keys(deployment).sort(), [
  'PREVIEW_CONTAINER', 'PREVIEW_DATABASE', 'PREVIEW_PLAYWRIGHT_API',
]);
assert.ok(Object.values(deployment).every(value => value === null));
JS
# The API is bundled; neither Oryx nor the host should run its source build scripts.
node - <<'JS'
const fs = require('node:fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.scripts = {};
pkg.engines = { node: '22.x' };
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
JS
