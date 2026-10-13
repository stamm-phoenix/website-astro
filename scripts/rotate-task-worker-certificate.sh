#!/usr/bin/env bash
# Update one setting through Azure CLI's merge operation, preserving the deployed timer package.
set -euo pipefail
umask 077
settings_file="$(mktemp)"
trap 'rm -f "$settings_file"' EXIT
subscription_id="$(az account show --query id --output tsv)"
az rest --method post \
  --uri "https://management.azure.com/subscriptions/$subscription_id/resourceGroups/website-astro/providers/Microsoft.Web/staticSites/website-astro/listAppSettings?api-version=2023-12-01" \
  --output json | python3 -c 'import json, sys
certificate = json.load(sys.stdin)["properties"]["AZURE_CLIENT_CERT"]
if not isinstance(certificate, str) or not certificate.strip():
    raise SystemExit("Website certificate is missing")
json.dump({"AZURE_CLIENT_CERT": certificate}, sys.stdout)' > "$settings_file"
az functionapp config appsettings set --resource-group website-astro \
  --name website-astro-task-reminders --settings "@$settings_file" --output none
printf '%s\n' 'Timer certificate updated; existing app settings retained.'
