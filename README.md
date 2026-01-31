# Stamm Phoenix Website
Modern site for the DPSG Stamm Phoenix (Feldkirchen-Westerham) built with Astro and Tailwind. The site currently lives at [dev.stamm-phoenix.de](https://dev.stamm-phoenix.de) and is deployed via Azure Static Web Apps.

> Before deploying to production, set the `SITE_URL` environment variable (e.g. in `.env.production`) so canonical URLs, Open Graph tags, sitemap, and robots.txt point to the live hostname.

## Tech stack
- Astro 5, static output to `dist`
- Tailwind CSS 4 (tokens and utilities in `src/styles/global.css`; legacy config in `tailwind.config.cjs`)
- TypeScript utilities for event handling (`src/lib/events.ts`)
- pnpm for dependency management, Node 20+ (see `package.json` engines)
- Azure Static Web Apps CI/CD (`.github/workflows/azure-static-web-apps-*.yml`)

## Getting started
- Enable Corepack and install deps: `corepack enable` then `pnpm install`
- Develop: `pnpm dev` (http://localhost:4321)
- Build: `pnpm build` → outputs to `dist/`
- Preview a build: `pnpm preview`
- Optional shortcuts are in `justfile` (e.g., `just dev`, `just build`)

## Content & data
- Homepage copy: `src/data/homepage.json` (hero, quick info cards, CTA)
- Gruppenstunden: `src/data/gruppenstunden/*.json` (one file per age group; sorted by `order`)
- Aktionen/Termine: `src/data/aktionen.json` (requires `uid` and ISO `start`; optional `end`, `allDay`, `summary`, `location`, `description`, `url`)
- Event helpers and formatting live in `src/lib/events.ts` (parsing, filtering, group emoji handling)
- Static assets and logos live in `public/`
- No CMS/admin dashboard is wired up at the moment; edit the JSON files directly in the repo

## Pages
- `/` – hero, quick info, CTA to mitmachen
- `/gruppenstunden` – weekly meeting times from JSON data
- `/aktionen` – upcoming events with group filters; detail pages at `/aktionen/[uid]`
- `/mitmachen` – embeds the Campflow membership form (requires JS)
- `/kontakt` – contact details
- `/impressum` – legal information

## Styling
- Global theme tokens, gradients, and utility classes are defined in `src/styles/global.css`
- Base layout and shell: `src/layouts/BaseLayout.astro`; navigation/footer in `src/components/`

## Testing
- Minimal Cypress smoke test at `cypress/e2e/index.cy.js` (`pnpm exec cypress run` or `pnpm exec cypress open`)
