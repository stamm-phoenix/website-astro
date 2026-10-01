#!/usr/bin/env bash
# Adds or removes the login callback of a preview environment in the Entra app
# registration of the website, so that signing in works on PR previews.
#
# Usage: entra-preview-redirect.sh add <preview-host>
#        entra-preview-redirect.sh remove <pr-number>
#
# Needs a logged-in Azure CLI (azure/login) and ENTRA_WEBSITE_APP_OBJECT_ID.
# "remove" deletes every callback of a *.azurestaticapps.net host ending in
# -<pr-number>, so it does not need to know the exact host of the preview.
set -euo pipefail

action="${1:?action (add|remove) missing}"
target="${2:?preview host or PR number missing}"
app="${ENTRA_WEBSITE_APP_OBJECT_ID:?ENTRA_WEBSITE_APP_OBJECT_ID missing}"

current_uris() {
  az ad app show --id "$app" --query 'web.redirectUris' -o json
}

case "$action" in
  add)
    if [[ ! "$target" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)*\.azurestaticapps\.net$ ]]; then
      echo "::error::Unexpected preview host: $target"
      exit 1
    fi
    uri="https://$target/.auth/login/aad/callback"
    re=''
    filter='. + [$uri] | unique'
    check='index($uri) != null'
    ;;
  remove)
    if [[ ! "$target" =~ ^[0-9]+$ ]]; then
      echo "::error::Unexpected PR number: $target"
      exit 1
    fi
    uri=''
    re="^https://[a-z0-9-]+-$target\\.([a-z0-9-]+\\.)*azurestaticapps\\.net/"
    filter='map(select(test($re) | not))'
    check='all(test($re) | not)'
    ;;
  *)
    echo "::error::Unknown action: $action"
    exit 1
    ;;
esac

# Graph replaces the whole list on update. Two PR runs at the same time can
# overwrite each other's change, so read back and retry until it sticks.
for attempt in 1 2 3 4 5; do
  uris="$(current_uris)"
  if jq -e --arg uri "$uri" --arg re "$re" "$check" <<<"$uris" >/dev/null; then
    echo "Redirect URIs up to date ($action $target)."
    exit 0
  fi
  mapfile -t updated < <(jq -r --arg uri "$uri" --arg re "$re" "$filter | .[]" <<<"$uris")
  echo "Attempt $attempt: $action $target"
  az ad app update --id "$app" --web-redirect-uris "${updated[@]}"
  sleep $((attempt * 3))
done

if jq -e --arg uri "$uri" --arg re "$re" "$check" <<<"$(current_uris)" >/dev/null; then
  echo "Redirect URIs up to date ($action $target)."
  exit 0
fi
echo "::error::Could not $action redirect URI for $target"
exit 1
