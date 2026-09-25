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
- `/nikolaus` – Nikolausdienst Q&A and booking (only linked while active); `/nikolaus/termin` lets families manage their booking
- `/impressum` – legal information

## Nikolausdienst (`/nikolaus`)

Families book a 30-minute Nikolaus visit online; bookings are stored in a SharePoint list via the API (`api/endpoints/nikolaus-*.ts`).

- **Config:** `api/lib/nikolaus-config.ts` (also imported by the frontend) – on/off switch (`active`), days, teams per day, start/end time, reservation hold time, change deadline (`changeDeadlineHours`, default 24 h before the appointment). Changes take effect with the next deployment. With `active: false` the nav entry and homepage banner disappear, `/nikolaus` only shows the Q&A and the API rejects bookings.
- **Flow:** a booking reserves its slot for `pendingHoldMinutes` (status `Ausstehend`) and sends a mail linking to `/nikolaus/termin?token=…`. On this management page the family confirms (`Bestaetigt`), changes their details, moves the booking to another free slot or cancels (`Storniert`). Changes and cancellations are only possible until the change deadline. Unconfirmed reservations expire (`Abgelaufen`).
- **One booking per e-mail address:** a second booking with an address that already has an active booking is rejected (409 `EMAIL_EXISTS`, concurrent requests are resolved like slot claims). Instead, the family can request a new management link – from that hint or from the "Schon gebucht?" section on `/nikolaus`. As only a hash of the token is stored, a new token is issued and older links stop working. At most one link mail per booking every 15 minutes (`LinkGesendetAm`); the answer does not reveal whether an address has a booking.
- **Overbooking protection:** the booking is written first, then all bookings of the slot are re-read. If `teams` older active bookings (lower item ID) already exist, the new item is deleted and the request answered with HTTP 409. Rescheduling claims the target slot the same way with a copy of the booking (same token) and only then deletes the old item; the old item is never moved, as its lower ID would outrank newer bookings in the target slot.
- **Address map:** once street, postal code and town are entered, `/api/nikolaus/geocode` locates the address via OpenStreetMap Nominatim (server-side, cached, max. 1 request/s, postal code of results checked because Nominatim does not filter reliably) and a Leaflet map with OSM tiles shows it together with the base (`area.base` in the config). Soft hints only: address not found, postal code outside `area.servicePostalCodes`, distance above `area.farDistanceKm`. The server geocodes again on booking and on address changes and stores the coordinates; geocoding never blocks a booking.
- **SharePoint list columns** (create with these internal names first, rename afterwards if desired). Dates are stored as text pairs `…Datum` (`YYYY-MM-DD`) / `…Uhrzeit` (`HH:MM`) in German local time, because the "Date and time" column type did not work reliably:

  | Internal name | Type |
  | --- | --- |
  | `Title` | Single line of text (family name) |
  | `Email` | Single line of text |
  | `Telefon` | Single line of text |
  | `Strasse` | Single line of text |
  | `PLZ` | Single line of text |
  | `Ort` | Single line of text |
  | `AdressHinweise` | Multiple lines of text (plain), optional |
  | `AnzahlKinder` | Number (0 decimal places) |
  | `MitKrampus` | Yes/No |
  | `Versteck` | Multiple lines of text (plain) |
  | `Bemerkungen` | Multiple lines of text (plain), optional |
  | `Breitengrad` / `Laengengrad` | Single line of text (set by the API, 6 decimals) |
  | `GeoGenauigkeit` | Single line of text: `Adresse`, `Straße`, `Ort`, `nicht gefunden` or `nicht ermittelt` |
  | `SlotKey` | Single line of text, indexed (source of truth for the appointment) |
  | `TerminDatum` / `TerminUhrzeit` | Single line of text |
  | `Status` | Choice: `Ausstehend`, `Bestaetigt`, `Storniert`, `Abgelaufen` |
  | `TokenHash` | Single line of text |
  | `ReserviertBisDatum` / `ReserviertBisUhrzeit` | Single line of text |
  | `BestaetigtAmDatum` / `BestaetigtAmUhrzeit` | Single line of text |
  | `GeaendertAmDatum` / `GeaendertAmUhrzeit` | Single line of text |
  | `LinkGesendetAmDatum` / `LinkGesendetAmUhrzeit` | Single line of text |

- **API environment variables:** `SHAREPOINT_NIKOLAUS_LIST_ID`, `NIKOLAUS_MAIL_SENDER` (mailbox the mails are sent from), `NIKOLAUS_SITE_URL` (base URL for mail links, e.g. `https://stamm-phoenix.de`).
- **App registration permissions:** write access to the site (`Sites.ReadWrite.All`, or `Sites.Selected` with role `write`) and application permission `Mail.Send` (ideally restricted to the sender mailbox).
- **Local testing:** copy `api/local.settings.example.json` to `api/local.settings.json`, fill it in, run `just dev-full` and open http://localhost:4280.

## Leitendenbereich (`/leitendenbereich`)

Internal area for leaders, only reachable with a Microsoft account of the Stamm Phoenix tenant.

- **Login:** Static Web Apps custom Entra ID provider (Standard plan), configured in `web/public/staticwebapp.config.json`. The `openIdIssuer` contains our tenant ID, so only accounts of our organisation can sign in. `/login` and `/logout` are shortcuts, other providers (GitHub, Twitter) are blocked.
- **Protection:** the routes `/leitendenbereich/*` and `/api/intern/*` require the role `authenticated`; anonymous visitors are redirected to the login. Every `/api/intern/*` endpoint additionally calls `requireStaff()` (`api/lib/staff-auth.ts`), which checks the `x-ms-client-principal` header and compares the tenant claim with `AZURE_TENANT_ID` when one is present (in Azure, SWA does not forward claims to the API; the tenant is enforced by the login).
- **Modules:** tiles on the start page come from `STAFF_MODULES` in `web/src/lib/staffModules.ts`. First module: `/leitendenbereich/nikolaus`, a read-only list/matrix of the Nikolaus bookings (`GET /api/intern/nikolaus/bookings`).
- **App registration:** the login reuses the existing registration (`AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`). It needs a *Web* platform with the redirect URI `https://<domain>/.auth/login/aad/callback` (also for preview environments) and ID tokens enabled; `AZURE_CLIENT_SECRET` must hold a valid client secret.
- **Local testing:** `just dev-full`, then open http://localhost:4280/leitendenbereich. The SWA CLI shows a mock login: use provider `aad` and role `authenticated`. If you add a `tid` claim, it must match `AZURE_TENANT_ID`.

## Styling

- Global theme tokens, gradients, and utility classes are defined in `web/src/styles/global.css`
- Base layout and shell: `web/src/layouts/BaseLayout.astro`; navigation/footer in `web/src/components/`

## Testing

- Build validation: `bun run build` (in `web/` and `api/`)
