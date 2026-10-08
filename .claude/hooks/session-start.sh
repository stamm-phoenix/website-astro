#!/bin/bash
# Builds the flake outputs in cloud sessions. The container is cached after
# this hook, so later sessions start the Azure MCP server (`nix run .#azure-mcp`
# in .mcp.json) without the build that exceeds the 30 s MCP connect timeout.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ] || ! command -v nix >/dev/null; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
system=$(nix eval --impure --raw --expr builtins.currentSystem)
nix build --no-link --no-write-lock-file \
  .#azure-mcp \
  ".#devShells.$system.default"
