# flake.nix
{
  description = "A development environment for Astro.js with Prettier and ESLint";

  inputs = {
    # Use nixpkgs unstable for potentially newer package versions,
    # or pin to a specific release like "nixos-23.11"
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
  # Use flake-utils to generate outputs for common systems (x86_64-linux, aarch64-linux, x86_64-darwin, aarch64-darwin)
    flake-utils.lib.eachDefaultSystem (system: let
      # Import nixpkgs for the specific system
      pkgs = import nixpkgs {inherit system;};

      # Specify the Node.js version (LTS versions are generally recommended for Astro)
      # Check Astro's documentation for the minimum required version if needed.
      nodejs = pkgs.nodejs; # Or pkgs.nodejs_18, etc.

      # Use pnpm as the package manager (Astro also supports npm and yarn)
      pnpm = pkgs.nodePackages.pnpm;

      # Get Prettier and ESLint from nodePackages for better integration
      # These provide the command-line tools. Project-specific plugins
      # should still be installed via pnpm/npm/yarn in your package.json.
      prettier = pkgs.nodePackages.prettier;
      eslint = pkgs.nodePackages.eslint;
    in {
      # Define the default development shell
      devShells.default = pkgs.mkShell {
        # Packages available in the shell environment
        buildInputs = [
          nodejs
          pnpm
          prettier
          eslint
          pkgs.git # Git is usually needed for development workflows
          # Add any other system-level dependencies your project might need here
          # e.g., pkgs.imagemagick for image processing
        ];

        # Commands to run when entering the shell
        shellHook = ''
          echo "--- Astro Dev Shell ---"
          echo "Node.js:  $(node --version)"
          echo "pnpm:     $(pnpm --version)"
          echo "Prettier: $(prettier --version)"
          echo "ESLint:   $(eslint --version)"
          echo "-----------------------"
          echo "Hint: Run 'pnpm install' if you haven't already."
          echo "Use 'pnpm dev', 'pnpm format', 'pnpm lint', etc. (configure scripts in package.json)."

          # Add locally installed node modules' binaries to the PATH
          # This makes commands installed via pnpm (like 'astro') directly available
          export PATH="./node_modules/.bin:$PATH"
        '';
      };
    });
}
