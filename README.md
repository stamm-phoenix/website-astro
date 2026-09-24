# Stamm Phoenix Website

Modern site for the DPSG Stamm Phoenix (Feldkirchen-Westerham) built with Astro and Tailwind. The site currently lives at [stamm-phoenix.de](https://stamm-phoenix.de) and is deployed via Azure Static Web Apps.

> Before deploying to production, set the `SITE_URL` environment variable (e.g. in `.env.production`) so canonical URLs, Open Graph tags, sitemap, and robots.txt point to the live hostname.

## Tech stack

- Astro 5, static output to `web/dist`
- Tailwind CSS 4 (tokens and utilities in `web/src/styles/global.css`; legacy config in `tailwind.config.cjs`)
- TypeScript utilities for event handling (`web/src/lib/events.ts`)
- Bun for dependency management
- Azure Static Web Apps CI/CD (`.github/workflows/azure-static-web-apps-*.yml`)

## Repository layout

- `web/` – Astro frontend (built to `web/dist`, deployed as the SWA app)
- `api/` – Azure Functions backend (deployed as the SWA `api_location`)

## Getting started

- Install deps: `cd web && bun install` (and `cd api && bun install` for the API)
- Develop: `bun run dev` in `web/` (http://localhost:4321)
- Build: `bun run build` in `web/` → outputs to `web/dist/`; `bun run build` in `api/` compiles the functions
- Lint: `bun run lint` in `web/` or `api/`
- Optional shortcuts are in `justfile` (e.g., `just dev`, `just build`, `just lint-api`)

## Content & data

- Homepage copy: `web/src/data/homepage.json` (hero, quick info cards, CTA)
- Gruppenstunden: `web/src/data/gruppenstunden/*.json` (one file per age group; sorted by `order`)
- Aktionen/Termine: `web/src/data/aktionen.json` (requires `uid` and ISO `start`; optional `end`, `allDay`, `summary`, `location`, `description`, `url`)
- Event helpers and formatting live in `web/src/lib/events.ts` (parsing, filtering, group emoji handling)
- Static assets and logos live in `web/public/`
- No CMS/admin dashboard is wired up at the moment; edit the JSON files directly in the repo

## Pages

- `/` – hero, quick info, CTA to mitmachen
- `/gruppenstunden` – weekly meeting times from JSON data
- `/aktionen` – upcoming events with group filters; detail pages at `/aktionen/[uid]`
- `/mitmachen` – embeds the Campflow membership form (requires JS)
- `/kontakt` – contact details
- `/impressum` – legal information

## Styling

- Global theme tokens, gradients, and utility classes are defined in `web/src/styles/global.css`
- Base layout and shell: `web/src/layouts/BaseLayout.astro`; navigation/footer in `web/src/components/`

## Testing

- Build validation: `bun run build` (in `web/` and `api/`)
