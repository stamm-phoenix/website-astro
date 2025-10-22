{
  description = "Astro development environment with pnpm";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      devShells.default = pkgs.mkShell {
        buildInputs = with pkgs; [
          # Node.js and pnpm
          nodejs_20
          pnpm

          git

          python3
          gcc
          pkg-config
        ];

        shellHook = ''
          echo "🚀 Astro development environment loaded!"
          echo "Node.js version: $(node --version)"
          echo "pnpm version: $(pnpm --version)"
          echo ""
          echo "To create a new Astro project:"
          echo "  pnpm create astro@latest"
          echo ""
          echo "To install dependencies in existing project:"
          echo "  pnpm install"
          echo ""
          echo "To start development server:"
          echo "  pnpm dev"
        '';

        # Set environment variables
        PNPM_HOME = "$PWD/.pnpm";
        PATH = "$PNPM_HOME:$PATH";
      };
    });
}
