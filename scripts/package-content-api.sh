#!/usr/bin/env bash
# The content refresh uses an already tested production commit; bundle it without another tsc.
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repository_root/api"
bun install --frozen-lockfile --ignore-scripts
node scripts/bundle.mjs
bash "$repository_root/scripts/package-swa-api.sh" "$repository_root/content-swa-api"
node scripts/check-deployment.mjs "$repository_root/content-swa-api"
