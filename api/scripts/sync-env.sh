#!/usr/bin/env bash
# Copies the environment variables of env.json into the "Values" of local.settings.json.
# New variables are added, existing ones are overwritten, others in local.settings.json are kept.
# env.json uses the format of the Azure SWA "Advanced edit" view: [{ "name": "KEY", "value": "…" }, …]
#
# Usage (in api/): scripts/sync-env.sh [env.json] [local.settings.json]
set -euo pipefail

env_file=${1:-env.json}
settings_file=${2:-local.settings.json}

if ! jq -e 'type == "array" and all(.[]; (.name | type) == "string" and (.value | type) == "string")' \
  "$env_file" >/dev/null; then
  echo "$env_file must be an array of { \"name\": string, \"value\": string }" >&2
  exit 1
fi

# Names only, values are never printed.
jq -r --slurpfile env "$env_file" '
  (.Values // {}) as $old
  | ($env[0] | map(select($old[.name] == null)) | map(.name)) as $added
  | ($env[0] | map(select($old[.name] != null and $old[.name] != .value)) | map(.name)) as $updated
  | "Added (\($added | length)): \($added | join(", "))",
    "Updated (\($updated | length)): \($updated | join(", "))"
' "$settings_file"

updated=$(jq --slurpfile env "$env_file" \
  '.Values = (.Values // {}) + ($env[0] | map({ (.name): .value }) | add // {})' "$settings_file")
# Write in place so the file keeps its permissions.
printf '%s\n' "$updated" >"$settings_file"
