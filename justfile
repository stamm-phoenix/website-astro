# Justfile for website-astro

# List available recipes
default:
    @just --list

# Start development server
dev:
    cd web && bun run dev

# Build the project
build:
    cd web && bun run build

# Build the API
build-api:
    cd api && bun run build

# Update dependencies
update:
    cd web && bun update
    cd api && bun update
    nix flake update

# Preview build
preview:
    cd web && bun run build
    cd web && bun run preview --host

# Lint code
lint:
    cd web && bun run lint

# Lint API code
lint-api:
    cd api && bun run lint

# Format code
format:
    cd web && bun run format

# Start frontend + API behind the SWA CLI proxy (http://localhost:4280)
# Requires api/local.settings.json (see api/local.settings.example.json)
# steam-run (NixOS) is only used when available
dev-full:
    cd api && bun run build
    cd api && $(command -v steam-run || true) ./node_modules/.bin/swa start http://localhost:4321 --api-location . --swa-config-location ../web/public --run "cd ../web && bun run dev"
