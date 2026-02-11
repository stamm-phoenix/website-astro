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

      bun = pkgs.bun;
    in {
      packages.astro = pkgs.stdenv.mkDerivation {
        pname = "astro-built";
        version = "0.1.0";
        src = ./.;

        nativeBuildInputs = [bun];

        buildPhase = ''
          set -euo pipefail
          cd "$src"

          export HOME=$(mktemp -d)
          bun install --frozen-lockfile
          bun run build

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
          buildInputs = [bun];
          src = ./.;
        } ''
          set -euo pipefail
          cd "$src"
          export HOME=$(mktemp -d)

          bun install --frozen-lockfile
          bun run build

          if [ ! -d dist ]; then
            echo "ERROR: build didn't produce a 'dist/' directory"
            exit 1
          fi

          mkdir -p $out
          tar -C dist -czf $out/astro-dist.tar.gz .
        '';

      devShells.default = pkgs.mkShell {
        buildInputs = [
          bun
          pkgs.git
          pkgs.direnv
          pkgs.ripgrep
          pkgs.just
          pkgs.cypress
          pkgs.steam-run
          pkgs.act
        ];

        shellHook = ''
          alias swa='steam-run swa'
          echo "📦 shell: bun $(bun --version)"
          echo "Run: bun install  — bun run build  — bun run dev"
        '';
      };
    });
}
