# Justfile for website-astro

# List available recipes
default:
    @just --list

# Start development server
dev:
    pnpm dev

# Build the project
build:
    pnpm build

# Update dependencies
update:
    pnpm update
    nix flake update

# Run tests (Cypress)
test:
    pnpm exec cypress run

# Open Cypress for interactive testing
test-open:
    pnpm exec cypress open

preview:
    pnpm build
    pnpm preview --host
