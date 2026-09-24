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
- `/nikolaus` – Nikolausdienst Q&A and booking (only linked while active); `/nikolaus/bestaetigen` confirms/cancels bookings
- `/impressum` – legal information

## Nikolausdienst (`/nikolaus`)

Families book a 30-minute Nikolaus visit online; bookings are stored in a SharePoint list via the API (`api/endpoints/nikolaus-*.ts`).

- **Config:** `api/lib/nikolaus-config.ts` (also imported by the frontend) – on/off switch (`active`), days, teams per day, start/end time, reservation hold time. Changes take effect with the next deployment. With `active: false` the nav entry and homepage banner disappear, `/nikolaus` only shows the Q&A and the API rejects bookings.
- **Flow:** a booking reserves its slot for `pendingHoldMinutes` (status `Ausstehend`) and sends a mail linking to `/nikolaus/bestaetigen`, where the family confirms (`Bestaetigt`) or cancels (`Storniert`). Unconfirmed reservations expire (`Abgelaufen`).
- **Overbooking protection:** the booking is written first, then all bookings of the slot are re-read. If `teams` older active bookings (lower item ID) already exist, the new item is deleted and the request answered with HTTP 409.
- **SharePoint list columns** (create with these internal names first, rename afterwards if desired):

  | Internal name | Type |
  | --- | --- |
  | `Title` | Single line of text (family name) |
  | `Email` | Single line of text |
  | `Telefon` | Single line of text |
  | `Termin` | Date and time (include time) |
  | `MitKrampus` | Yes/No |
  | `SlotKey` | Single line of text, indexed |
  | `Status` | Choice: `Ausstehend`, `Bestaetigt`, `Storniert`, `Abgelaufen` |
  | `TokenHash` | Single line of text |
  | `ReserviertBis` | Date and time (include time) |
  | `BestaetigtAm` | Date and time (include time) |

- **API environment variables:** `SHAREPOINT_NIKOLAUS_LIST_ID`, `NIKOLAUS_MAIL_SENDER` (mailbox the mails are sent from), `NIKOLAUS_SITE_URL` (base URL for mail links, e.g. `https://stamm-phoenix.de`).
- **App registration permissions:** write access to the site (`Sites.ReadWrite.All`, or `Sites.Selected` with role `write`) and application permission `Mail.Send` (ideally restricted to the sender mailbox).
- **Local testing:** copy `api/local.settings.example.json` to `api/local.settings.json`, fill it in, run `just dev-full` and open http://localhost:4280.

## Styling

- Global theme tokens, gradients, and utility classes are defined in `web/src/styles/global.css`
- Base layout and shell: `web/src/layouts/BaseLayout.astro`; navigation/footer in `web/src/components/`

## Testing

- Build validation: `bun run build` (in `web/` and `api/`)
