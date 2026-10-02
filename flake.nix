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
      node = pkgs.nodejs_22;
      azureMcp = pkgs.azure-mcp.overrideAttrs (previous: {
        buildInputs =
          (previous.buildInputs or [])
          ++ [pkgs.icu pkgs.openssl pkgs.zlib]
          ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
            pkgs.alsa-lib
            pkgs.gst_all_1.gstreamer
            pkgs.libX11
            pkgs.webkitgtk_4_1
            pkgs.gtk3
            pkgs.pango
            pkgs.harfbuzz
            pkgs.at-spi2-core
            pkgs.cairo
            pkgs.gdk-pixbuf
            pkgs.libsoup_3
            pkgs.glib
            pkgs.libsecret
            pkgs.p11-kit
            pkgs.util-linux
          ];
        installPhase = ''
          runHook preInstall

          # Keep the executable name and adjacent .NET runtime files intact.
          # A hidden executable name breaks System.CommandLine command discovery.
          mkdir -p "$out/libexec/azure-mcp"
          cp -r . "$out/libexec/azure-mcp/"
          chmod +x "$out/libexec/azure-mcp/azmcp"

          makeWrapper "$out/libexec/azure-mcp/azmcp" "$out/bin/azure-mcp" \
            --prefix PATH : ${pkgs.lib.makeBinPath [pkgs.azure-cli]} \
            --prefix ${
            if pkgs.stdenv.hostPlatform.isDarwin
            then "DYLD_LIBRARY_PATH"
            else "LD_LIBRARY_PATH"
          } : ${pkgs.lib.makeLibraryPath [pkgs.icu pkgs.openssl pkgs.zlib]}

          runHook postInstall
        '';
      });
    in {
      packages.azure-mcp = azureMcp;

      apps.azure-mcp = {
        type = "app";
        program = pkgs.lib.getExe azureMcp;
        meta.description = azureMcp.meta.description;
      };

      packages.astro = pkgs.stdenv.mkDerivation {
        pname = "astro-built";
        version = "0.1.0";
        src = ./web;

        nativeBuildInputs = [bun];

        buildPhase = ''
          set -euo pipefail

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
          src = ./web;
        } ''
          set -euo pipefail

          cp -r $src/* .
          chmod -R u+w .

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
          node
          pkgs.azure-cli
          azureMcp
          pkgs.git
          pkgs.direnv
          pkgs.ripgrep
          pkgs.just
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
