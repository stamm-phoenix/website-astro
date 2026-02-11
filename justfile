# Justfile for website-astro

# List available recipes
default:
    @just --list

# Start development server
dev:
    bun run dev

# Build the project
build:
    bun run build

# Update dependencies
update:
    bun update
    nix flake update

# Run tests (Cypress)
test:
    bun run cypress run

# Open Cypress for interactive testing
test-open:
    bun run cypress open

# Preview build
preview:
    bun run build
    bun run preview --host

# Lint code
lint:
    bun run lint

# Format code
format:
    bun run format
