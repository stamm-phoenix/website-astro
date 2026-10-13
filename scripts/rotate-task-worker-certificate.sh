#!/usr/bin/env bash
# Rotate in Key Vault; Function App settings and the deployed package remain unchanged.
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/.." && pwd)"
worker_principal="$(az functionapp identity show --resource-group website-astro --name website-astro-task-reminders --query principalId --output tsv)"
if [[ -z "$worker_principal" || "$worker_principal" == null ]]; then
  echo 'The timer requires its system-assigned managed identity.' >&2
  exit 1
fi
az deployment group create --resource-group website-astro \
  --template-file "$repository_root/infrastructure/task-reminder-secrets.bicep" \
  --parameters workerPrincipalId="$worker_principal" --output none
worker_id="$(az functionapp show --resource-group website-astro --name website-astro-task-reminders --query id --output tsv)"
az rest --method post --uri "https://management.azure.com$worker_id/config/configreferences/appsettings/refresh?api-version=2023-12-01" --output none
printf '%s\n' 'Timer certificate rotated in Key Vault; app settings retained.'
