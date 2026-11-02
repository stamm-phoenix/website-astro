#!/usr/bin/env bash
# Prepares a fresh git worktree: Nix dev shell, dependencies, local API settings, Azure login.
# Safe to run again; every step only does what is missing.
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repository_root"

nix_profile=/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
if ! command -v nix >/dev/null && [[ -r "$nix_profile" ]]; then
  # shellcheck disable=SC1090
  source "$nix_profile"
fi

if ! command -v nix >/dev/null; then
  echo 'nix is missing; install it first (https://nixos.org/download).' >&2
  exit 1
fi

nix_develop() {
  nix --extra-experimental-features 'nix-command flakes' develop --no-write-lock-file --command "$@"
}

echo '==> Nix dev shell (bun, node, azure-cli, azure-mcp, just, …)'
nix_develop true

echo '==> Dependencies of web/ and api/'
nix_develop bun run install:all

main_worktree="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
settings=api/local.settings.json
if [[ ! -e "$settings" && "$main_worktree" != "$repository_root" && -f "$main_worktree/$settings" ]]; then
  echo "==> Copying $settings from the main checkout"
  cp "$main_worktree/$settings" "$settings"
  chmod 600 "$settings"
fi

echo '==> Azure CLI'
if nix_develop az account show --query user.name -o tsv >/dev/null 2>&1; then
  echo "Already logged in as $(nix_develop az account show --query user.name -o tsv)."
elif [[ -t 0 && -t 1 ]]; then
  # The login is stored in ~/.azure and shared by all worktrees.
  nix_develop az login --use-device-code
else
  echo 'Not logged in to Azure. Run: nix develop --command az login --use-device-code' >&2
fi

echo 'Done. Enter the shell with: nix develop'
