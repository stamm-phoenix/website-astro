#!/usr/bin/env bash
# Build a standalone timer app. SWA keeps its separate HTTP-only package entry point.
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/.." && pwd)"
package_dir="${1:?Pass a new output directory outside the repository}"
if [[ "$package_dir" != /* ]]; then
  echo 'Pass an absolute output directory.' >&2
  exit 1
fi
if [[ -e "$package_dir" || -e "$package_dir.zip" ]]; then
  echo 'Output already exists; choose a new output directory.' >&2
  exit 1
fi
cd "$repository_root/api"
bun install --frozen-lockfile --ignore-scripts
rm -rf dist
bun run build
mkdir -p "$package_dir/dist"
cp -R dist/lib "$package_dir/dist/"
cp -R dist/timers "$package_dir/dist/"
node - "$package_dir" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[2];
const source = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const names = ['@azure/functions', '@azure/identity', '@microsoft/microsoft-graph-client', 'kysely', 'tarn', 'tedious'];
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
  name: 'phoenix-task-reminder-worker', version: source.version, private: true,
  main: 'dist/timers/task-reminders.js', engines: { node: '22.x' },
  dependencies: Object.fromEntries(names.map(name => [name, source.dependencies[name]])),
}, null, 2));
const host = JSON.parse(fs.readFileSync('host.json', 'utf8'));
host.functionTimeout = '00:10:00';
fs.writeFileSync(path.join(dir, 'host.json'), JSON.stringify(host, null, 2));
JS
cd "$package_dir"
npm install --package-lock-only --ignore-scripts --omit=dev --no-audit --no-fund
zip -qr "$package_dir.zip" .
echo 'Standalone timer package built.'
