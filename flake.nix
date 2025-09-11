{
  description = "The new website for DPSG Stamm Phoenix written in Astro";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {
        inherit system;
        config = {allowUnfree = true;};
      };

      node = pkgs.nodejs; # node runtime
      pnpm = pkgs.pnpm; # pnpm client
    in {
      packages.astro = pkgs.stdenv.mkDerivation {
        pname = "astro-built";
        version = "0.1.0";
        src = ./.;

        nativeBuildInputs = [pnpm];
        buildInputs = [node];

        buildPhase = ''
          set -euo pipefail
          cd "$src"

          export NPM_CONFIG_UNSAFE_PERM=1
          if [ -f pnpm-lock.yaml ]; then
            pnpm install --frozen-lockfile
          else
            pnpm install
          fi

          pnpm run build

          if [ ! -d dist ]; then
            echo "ERROR: build didn't produce a 'dist/' directory"
            exit 1
          fi

          mkdir -p $out
          cp -r dist/* $out/
        '';

        installPhase = "true";

        meta = with pkgs.lib; {
          description = "The new website for DPSG Stamm Phoenix written in Astro";
          maintainers = with maintainers; [
            hugo-berendi
            welles
          ];
          license = licenses.mit;
        };
      };

      packages.pack =
        pkgs.runCommand "astro-dist-tarball" {
          buildInputs = [pnpm node];
          src = ./.;
        } ''
          set -euo pipefail
          cd "$src"
          export NPM_CONFIG_UNSAFE_PERM=1

          if [ -f pnpm-lock.yaml ]; then
            pnpm install --frozen-lockfile
          else
            pnpm install
          fi

          pnpm run build

          if [ ! -d dist ]; then
            echo "ERROR: build didn't produce a 'dist/' directory"
            exit 1
          fi

          mkdir -p $out
          tar -C dist -czf $out/astro-dist.tar.gz .
        '';

      devShells.default = pkgs.mkShell {
        buildInputs = [
          node
          pnpm
          pkgs.git
          pkgs.direnv
          pkgs.ripgrep
        ];

        shellHook = ''
          export NPM_CONFIG_UNSAFE_PERM=1
          echo "📦 shell: node $(node --version) | pnpm $(pnpm --version)"
          echo "Run: pnpm install  — pnpm build  — pnpm dev"
          # Helpful PATH additions if needed (pnpm's global bins)
          if [ -d "$(pnpm bin -g 2>/dev/null || true)" ]; then
            export PATH="$(pnpm bin -g):$PATH"
          fi
        '';
      };
    });
}
