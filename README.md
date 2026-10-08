# Stamm Phoenix Website

Modern site for the DPSG Stamm Phoenix (Feldkirchen-Westerham) built with Astro and Tailwind. The site currently lives at [www.stamm-phoenix.de](https://www.stamm-phoenix.de) and is deployed via Azure Static Web Apps.

> Canonical URLs, Open Graph tags, sitemap, and robots.txt always use `https://www.stamm-phoenix.de` (the apex redirects there) (`site` in `web/astro.config.mjs`), also in preview builds, so previews are not indexed as separate pages. Links in mails use the address the request was sent to (production, preview or localhost, see `api/lib/site-url.ts`), so no site URL needs to be configured per environment.

## Tech stack

Versions below reflect the pinned dependencies in `web/package.json`,
`api/package.json` and the Bun lockfiles, plus the runtimes configured in CI.

| Layer                      | Version                                               | Usage                                                                                                         |
| -------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Astro                      | 7.3.5                                                 | Static frontend built to `web/dist`; Rust compiler is the Astro 7 default                                     |
| Svelte / Astro integration | 5.57.1 / `@astrojs/svelte` 9.0.1                      | Interactive islands and shared reactive state with Svelte 5 runes                                             |
| Tailwind CSS / Vite plugin | 4.3.3 / `@tailwindcss/vite` 4.3.3                     | CSS-first configuration in `web/src/styles/global.css` with `@import` and `@theme`; no legacy Tailwind config |
| Vite                       | 8.3.1 (resolved in `web/bun.lock`)                    | Build tooling supplied by Astro and the Svelte integration                                                    |
| TypeScript                 | Frontend 6.0.3; API 5.9.3                             | Frontend checked with `astro check` and `svelte-check`; API compiled with `tsc`                               |
| Bun / Node.js              | Bun 1.4.2; Node.js 22 in CI                           | Frozen-lockfile installs; local Node.js minimum is 22.12                                                      |
| Azure Functions            | `@azure/functions` 4.11.0 (Node programming model v4) | Separate TypeScript API in `api/`; Microsoft Graph and SharePoint access                                      |
| Playwright / ESLint        | 1.63.0 / 10.11.0                                      | Desktop/mobile Chromium workflows and frontend/API linting                                                    |

Azure Static Web Apps deploys the static frontend and the Functions API through
`.github/workflows/azure-static-web-apps-zealous-water-04f606303.yml`.

### Framework features in use

- Astro islands render public content at build time and hydrate with `client:load`
  or `client:visible`; browser-dependent interfaces use `client:only="svelte"`.
  The homepage news feed waits until visible before hydrating.
- `ClientRouter` in `web/src/layouts/BaseLayout.astro` handles client-side navigation.
  Astro prefetching is configured for all eligible links on hover; the Campflow
  embed uses `data-astro-rerun` to initialize after page changes.
- Svelte components and `.svelte.ts` state modules use `$props`, `$state`,
  `$derived` and `$effect` rather than requiring a migration from Svelte 4 syntax.
- Public API content and images are baked through `web/src/lib/content/` and
  `web/integrations/bakedContent.ts`, then refreshed in the browser. This is a
  custom build-time pipeline, not an Astro Content Layer collection.
- `astro:assets` optimizes the imported Nikolaus illustration with `<Image>`;
  its display size is controlled by Tailwind classes.

The site uses `output: 'static'` without an Astro server adapter. Server islands,
Astro Actions and Astro sessions would require an Astro runtime deployment;
authentication and writes currently belong to Azure SWA and the Functions API.
Astro's responsive image `layout` option and Fonts API are not configured. Incremental
static builds (experimental since Astro 7.2) are also not enabled: adopting them
would require per-page cache keys covering live content and images, persisted
Astro build caches, and verification of the existing staged-image/version pipeline.

## Repository layout

- `web/` – Astro frontend (built to `web/dist`, deployed as the SWA app)
- `api/` – Azure Functions backend (deployed as the SWA `api_location`)

## Getting started

Use Bun 1.4.2 and Node.js 22.12 or newer. `nix develop` provides Bun and Node
on NixOS. The commands below run from the repository root.

```sh
bun run install:all
bun run dev:mock
```

Open http://localhost:4321. Mock mode serves `/api/*` and `/.auth/*` from
`web/dev/mockApi.ts` and `web/dev/mock-data/`. It needs no Azure credentials or
`api/local.settings.json`. Edits change in-memory demo data; restarting the server
restores the fixtures. Unknown API paths return 404 instead of reaching Azure.
The demo API simplifies some validation and write conflicts. Browser tests check
the UI contracts; API tests exercise the actual booking and planning algorithms.
The mock middleware runs only in the dev server with `MOCK_API=1`; it is absent
from production builds. The membership form uses a local demo embed and sends no
applications. Other external widgets and map tiles may still use the network.

The mock clock is fixed to October 1, 2026 so booking deadlines and order windows
remain repeatable. Mock mode starts with a simulated staff login; `/logout`
switches to the anonymous view and `/login` restores it. Example links:

- http://localhost:4321/nikolaus/termin#token=mock for a confirmed booking.
- http://localhost:4321/nikolaus/termin#token=pending for confirmation.
- http://localhost:4321/nikolaus/termin#token=storniert or `token=abgelaufen` for inactive bookings.
- http://localhost:4321/mitgliederbereich/sammelbestellungen#kind=campaign&id=101&token=mock for an invitation.
- http://localhost:4321/mitgliederbereich/sammelbestellungen#kind=order&id=2001&token=mock for a member order.

For frontend development against an Azure Functions API and the SWA login proxy:

```sh
cp api/local.settings.example.json api/local.settings.json
# Fill in the secrets in api/local.settings.json (IDs and senders are in api/lib/config.ts).
bun run dev:full
```

Open http://localhost:4280. This command builds the API, starts the frontend and
starts the SWA CLI with Azure Functions and the routes in
`web/public/staticwebapp.config.json`. The CLI can download Functions Core Tools
on first use; on NixOS the launcher uses `steam-run` when available. Use the SWA
mock login with provider `aad` and role `authenticated` for the staff area.
The login is simulated, but API calls use the configured SharePoint lists and
mailboxes. Use `dev:mock` for demo data without those services.

`bun run dev` starts only the frontend. `bun run build` builds both projects.
The same shortcuts are available as `just dev-full`, `just dev-mock` and
`just check`.

## Checks and browser tests

```sh
bun run check
bun run build
bun run --cwd web test:e2e --list
bun run --cwd web test:e2e:install
bun run test:e2e
```

`bun run check` runs frontend ESLint, `astro check`, `svelte-check`, API ESLint
and the compiled Node API tests. The separate Svelte check is required because
Astro's check does not find all component errors. To run only frontend checks,
use `bun run --cwd web check`. API tests use simulated storage and mail responses.
The compilers stay on their existing versions; the TypeScript 7 migration is
tracked separately in [#98](https://github.com/stamm-phoenix/website-astro/issues/98).

Playwright starts an isolated mock dev server and runs desktop and mobile
Chromium tests. The suite covers navigation, the membership widget after page
changes, Nikolaus booking management, version conflicts and member orders.
The fixtures and intercepted external requests keep these runs independent of
production data and mail delivery. `bun run --cwd web test:e2e:ui` opens the test
UI. Reports are written to `web/test-results/report/`; failure screenshots and
traces are in `web/test-results/artifacts/`. Demo writes live in the dev server,
so every Playwright worker starts its own server on port 4323 + n (2 workers
locally, 4 in CI; override with `E2E_WORKERS`) and refuses to reuse a running
server. Test files run in parallel, tests within a file stay in order. CI splits
the Chromium tests into three shards (`--shard=1/3` etc.) and runs the WebKit
tests in a fourth job, so only that job installs WebKit's system packages. On NixOS, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium executable when
the downloaded browser cannot run.

CI runs the same frontend checks, both linters, API tests and browser tests on
pull requests and `main`. Both the build and browser jobs must pass before Azure
deployment. Failed browser runs upload their reports as artifacts.

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
- `/aktionen` – upcoming events with group filters, or a month grid (`?ansicht=monat&monat=YYYY-MM`, bars coloured by Stufe; `web/src/components/MonthGrid.svelte` is shared with the Leitendenbereich); detail pages at `/aktionen/[uid]`
- `/mitmachen` – embeds the Campflow membership form (requires JS)
- `/fragen-und-antworten` – categorized FAQs (Azure SQL)
- `/kontakt` – contact details and contact form (see below)
- `/nikolaus` – Nikolausdienst Q&A and booking (only linked while the online booking is switched on in the Steuerung); `/nikolaus/termin` lets families manage their booking
- `/impressum` – legal information

## Kontaktformular (`/kontakt`)

The form (`web/src/components/ContactForm.svelte`) posts to `POST /api/kontakt`. The API sends the message from `CONFIG.kontakt.mailbox` to the same mailbox with the visitor as Reply-To, so answering in Outlook goes straight to them. The visitor gets a receipt that contains none of their text, so the form cannot be used to send content to someone else's address. The address is not verified; the mail to the Stamm says so.

Spam protection: a self-hosted [ALTCHA](https://altcha.org) proof of work (`GET /api/kontakt/challenge`, no third party and no cookies), a honeypot field and a per-instance limit (`CONFIG.kontakt.hourlyLimit`/`dailyLimit`). Solved challenges are accepted once per instance until they expire. Topics and length limits live in `api/lib/kontakt-validation.ts`, shared with the frontend.

Setup:

- App Setting `KONTAKT_ALTCHA_SECRET`: a random secret, e.g. `openssl rand -hex 32`. Without it the form answers 503 and points to the mail address.
- The app registration needs `Mail.Send` for `kontakt@stamm-phoenix.de` (it must be a mailbox or shared mailbox, not a distribution list).

## Fragen & Antworten (`/fragen-und-antworten`)

Logged-in staff can create, edit and delete FAQ entries at
`/leitendenbereich/fragen-und-antworten`, available through the "Fragen & Antworten"
module. The editor supports questions, categories (free text, default: `Allgemein`;
the topics in use are suggested) and formatted answers. New entries start as drafts
and may have an empty answer. Only published entries appear in the public FAQ.
Unchecking "Veröffentlicht" hides an entry without deleting it; checking it again
publishes it.
`/api/intern/pflege/qa` uses the existing staff authentication, validation and audit
logging. Updates and deletes require the loaded ETag and return HTTP 409 if the
entry has changed.

The entries live in the table `content.faq` of the Azure SQL database
(`api/lib/qa-list.ts`, [docs/azure-sql.md](docs/azure-sql.md)); the public
`GET /api/qa` endpoint returns the published ones. Answers are sanitized before
they are stored and again before rendering.

## Blog (`/blog`)

Logged-in staff write posts at `/leitendenbereich/blog` (`/api/intern/pflege/blog`).
Posts live in `content.blog_post`, their images in `content.blog_image` (alt text,
size, order; the first one is the cover). The image files are in Azure Blob Storage
(`blog/<post>/<file>/<width>.jpg`, `api/lib/blog-images.ts`): the browser scales an
upload to at most 1600 px, the API stores it re-encoded (without metadata) in the
widths offered in `srcset` (800 and 1600 px, smaller images once at their own width).
Images are only served through the API (`/api/blog/<id>/bilder/<file>?w=…`), and only
for published posts.

## Nikolausdienst (`/nikolaus`)

Families book a 30-minute Nikolaus visit online; bookings, helpers and planning are stored in an Azure SQL database via the API (`api/endpoints/nikolaus-*.ts`, setup and schema in [docs/azure-sql.md](docs/azure-sql.md)).

- **Steuerung (`/leitendenbereich/nikolaus-steuerung`):** days with start and end time and teams per day, reservation hold time, change deadline, service area and three switches: online booking (nav entry, homepage banner, booking form; off: `/nikolaus` only shows the Q&A and the API rejects bookings), staff modules (off: only the Steuerung stays in the Leitendenbereich) and maintenance mode (every Nikolaus write except the Steuerung answers 503). Stored in `nikolaus.settings` and `nikolaus.day` (`api/lib/nikolaus-settings.ts`), read on every request; public changes start a content build, as the nav, banner and days are baked into the pages (`GET /api/nikolaus/settings`). Days and teams cannot be changed under bookings or plans that are still ahead. The Steuerung also shows when the data must be deleted (one calendar month after the last visit), deletes bookings or helpers after a typed confirmation, releases a stuck geocoding reservation and logs every change with the acting user. Helpers in `api/lib/nikolaus-config.ts` (shared with the frontend) derive slots and teams from the settings.
- **Flow:** a booking reserves its slot for `pendingHoldMinutes` (status `Ausstehend`) and sends a mail linking to `/nikolaus/termin#token=…`. On this management page the family confirms (`Bestaetigt`), changes their details, moves the booking to another free slot or cancels (`Storniert`). Changes and cancellations are only possible until the change deadline. Unconfirmed reservations expire (`Abgelaufen`).
- **One booking per e-mail address:** a second booking with an address that already has an active booking is rejected (409 `EMAIL_EXISTS`, checked in the same transaction as the slot capacity). Instead, the family can request a new management link – from that hint or from the "Schon gebucht?" section on `/nikolaus`. As only a hash of the token is stored, a new token is issued and older links stop working. At most one link mail per booking every 15 minutes (`link_sent_at`); the answer does not reveal whether an address has a booking.
- **Overbooking protection:** creating, moving a booking and changing its e-mail address run in one database transaction that holds a lock (`sp_getapplock`) while it counts the blocking bookings of the slot and writes; a full slot is answered with HTTP 409 `SLOT_FULL`. Moving changes the slot of the same row, the booking keeps its ID and token.
- **Address map:** once street, postal code and town are entered, `/api/nikolaus/geocode` locates the address via OpenStreetMap Nominatim (server-side, cached, max. 1 request/s, postal code of results checked because Nominatim does not filter reliably) and a Leaflet map with OSM tiles shows it together with the starting point of the teams. Soft hints only: address not found, postal code outside the service area, distance above the configured limit (all set in the Steuerung). The server geocodes again on booking and on address changes and stores the coordinates; geocoding never blocks a booking.
- **Database tables** (schema `nikolaus`, defined in `api/migrations/`): `booking` (one row per booking; status `Ausstehend`, `Bestaetigt`, `Storniert`, `Abgelaufen`; times in UTC; only a SHA-256 hash of the management token), `helper` and `helper_availability`, `assignment` (Einteilung), `dispo_visit` (Dispo), `state` (shared JSON documents), `settings` and `day` (Steuerung) and `audit_log` (its log). The database enforces types, required fields and references; deleting a booking or a helper removes their planning rows.
- **Shared state and operation:** mail quota and geocoding coordination are JSON documents in `nikolaus.state`, shared by all instances of an environment; each PR preview has its own database and therefore its own quota and pacing. Set `NIKOLAUS_STATE_SECRET` (at least 32 characters) for production and every preview. `CONFIG.nikolaus.mailHourlyLimit` / `mailDailyLimit` allow 100 / 500 admitted sends per sender in UTC windows. Management writes use the loaded row version (`etag`); new mail links use fragments and older query links remain compatible. See the [operation, Azure measurements and deletion runbook](docs/nikolaus-betrieb.md).
- **API configuration:** the database (`CONFIG.database`) and the sender mailbox (`CONFIG.mail.nikolausSender`) are in `api/lib/config.ts`; `OPENROUTESERVICE_API_KEY` (Dispo, see below) is an environment variable.
- **Dispo (`/leitendenbereich/nikolaus-dispo`):** distributes the confirmed bookings of a day to the teams (A–D, as many as `teams` of the day in the Steuerung, colours in `NIKOLAUS_TEAMS`). `GET /api/intern/nikolaus/dispo?date=` returns the bookings, a driving-time matrix (OpenRouteService with `OPENROUTESERVICE_API_KEY`, otherwise estimated from the air-line distance) and the saved Dispo; the browser calculates the routes with `api/lib/nikolaus-dispo.ts` (visit = children × 5 min, at least 10 min; rated by driving time and delays against the booked slot). `PUT /api/intern/pflege/nikolaus-dispo?date=` saves it. For the map, `POST /api/intern/nikolaus/dispo/routes?date=` returns each team's course along the roads (OpenRouteService directions, cached; straight lines without the service). Each save replaces the plan of the day in one transaction; see [saving the planning](docs/nikolaus-planungen.md).
- **Internal tags:** stored with the booking (`internal_tags`, JSON array), edited in the booking details (`PUT /api/intern/pflege/nikolaus-bookings/{id}/tags`). The tags are only returned by the staff endpoints, never in mails or `/api/nikolaus/manage/*`, and stay when a booking is moved.
- **Helfende and Einteilung (`/leitendenbereich/nikolaus-helfende`):** helpers volunteer per day for Nikolaus, Krampus, Fahrer*in, Engerl (one each per team) or Küche. `api/lib/nikolaus-einteilung.ts` (shared with the browser) solves all days as one min-cost flow: filled posts by importance first, then spreading the workload over more people, then positive tags. A helper with a negative tag is never put in a team whose route (saved Dispo) has a family with that tag; Dispo recalculation keeps such families away from teams with such helpers. Volunteers for Küche who are not needed in a team work in the kitchen; the rest of the day's volunteers are shown as „Ohne Aufgabe“. Endpoints: `GET /api/intern/nikolaus/helfende`, `POST`/`PATCH`/`DELETE /api/intern/pflege/nikolaus-helfende[/{id}]`, `GET /api/intern/nikolaus/einteilung`, `PUT /api/intern/pflege/nikolaus-einteilung`.
- **Test data:** `cd api && bun scripts/nikolaus-testdata.ts` fills every free place of the configured slots with invented, confirmed families (invented local addresses and synthetic coordinates, e-mails `@nikolaus-test.invalid`, phone numbers from the Bundesnetzagentur fiction range (089) 99998-xxx). `--dry-run` only shows them, `--delete` removes all test bookings (with their Dispo rows) again – run it before going live. About a quarter of the families get a group tag. `--helfende` (with `--dry-run`/`--delete`) does the same for about 30 invented helpers, marked with `[Test]` in their notes. Uses `api/local.settings.json`.
- **App registration permissions:** `db_datareader` and `db_datawriter` in the database ([docs/azure-sql.md](docs/azure-sql.md)) and application permission `Mail.Send` (ideally restricted to the sender mailbox).
- **Previews:** every PR preview gets its own database `website-pr-<number>` with invented test data (online booking and staff modules switched on), dropped when the PR closes ([docs/azure-sql.md](docs/azure-sql.md#previews)). Bookings made there never reach the production data.
- **Local testing:** copy `api/local.settings.example.json` to `api/local.settings.json`, fill it in, run `just dev-full` and open http://localhost:4280. The local API works on the database in `CONFIG.database`; your IP address needs a firewall rule ([docs/azure-sql.md](docs/azure-sql.md)). The API tests use a local SQL Server container instead.

## Leitendenbereich (`/leitendenbereich`)

Internal area for leaders, only reachable with a Microsoft account of the Stamm Phoenix tenant.

- **Login:** Static Web Apps custom Entra ID provider (Standard plan), configured in `web/public/staticwebapp.config.json`. The `openIdIssuer` contains our tenant ID, so only accounts of our organisation can sign in. `/login` and `/logout` are shortcuts, other providers (GitHub, Twitter) are blocked.
- **Protection:** the routes `/leitendenbereich/*` and `/api/intern/*` require the role `authenticated`; anonymous visitors are redirected to the login. Every `/api/intern/*` endpoint additionally calls `requireStaff()` (`api/lib/staff-auth.ts`), which checks the `x-ms-client-principal` header and compares the tenant claim with `CONFIG.azure.tenantId` when one is present (in Azure, SWA does not forward claims to the API; the tenant is enforced by the login).
- **Modules:** tiles on the start page come from `STAFF_MODULES` in `web/src/lib/staffModules.ts`; the Nikolaus pages (`NIKOLAUS_MODULES`) have their own section „Nikolausdienst“, shown while the staff modules are switched on in the Steuerung, which itself is always listed (`NIKOLAUS_CONTROL_MODULE`).
  - `/leitendenbereich/nikolaus-steuerung`: settings, deletion and log of the Nikolausdienst (see "Nikolausdienst" above).
  - `/leitendenbereich/nikolaus`: read-only list/matrix of the Nikolaus bookings (`GET /api/intern/nikolaus/bookings`).
  - `/leitendenbereich/nikolaus-dispo`: distribution of the visits to the teams with routes, map and print view (see "Nikolausdienst" above).
  - `/leitendenbereich/nikolaus-helfende`: helpers and their distribution to the teams (see "Nikolausdienst" above).
  - `/leitendenbereich/aktionen`: CampFlow events (January to December per year, or as a month grid with `?ansicht=monat&monat=YYYY-MM`; the page links the ICS feeds `leitende.ics` and `aktionen.ics` to subscribe) and their participants (`GET /api/intern/aktionen`, `GET /api/intern/aktionen/{evt_id}`), merged with the public calendar list. A CampFlow event can be published to the public calendar (choose Stufen and description; title, dates and registration link stay owned by CampFlow), and Aktionen without CampFlow can be created with free title, dates and link (`/api/intern/pflege/aktionen`). An Aktion planned ahead without CampFlow is linked later, either from its entry ("Mit CampFlow-Aktion verknüpfen") or when publishing the CampFlow event ("Vorhandenen Kalendereintrag übernehmen"); likely pairs are suggested, decided by the date (same start date, matching title within 30 days, or a shared word within 14 days; an Aktion of the same name in another year does not match), and the choices are sorted by date distance. Linked entries stay linked as long as their CampFlow event exists. Linked entries are tied by the `CampFlowId` column; `/api/aktionen` and the ICS feeds overlay title, dates and link live from CampFlow (cached 5 minutes) and fall back to the copy stored in SharePoint. Needs the app setting `CAMPFLOW_API_TOKEN`. The API only sends GET requests to CampFlow and strips `bank_account` and `sepa_mandate` before the data reaches the browser. CampFlow does not expose a payment status.
  - `/leitendenbereich/aktionen/fahrten`: plans the car pools of a CampFlow Aktion (`?id=<evt_id>`; without it the page lists the upcoming Aktionen). It reads the participants from `GET /api/intern/aktionen/{evt_id}` and takes the seats each family offers from two custom fields, one per direction, chosen on the page (guessed from names with "Hinfahrt" and "Rückfahrt"). The plan is computed in the browser (`web/src/lib/fahrtenPlan.ts`): as few cars as possible, larger cars first. Leitende ride with a Leitende driver, otherwise in the car of the oldest Stufe, and siblings share a car. Manual changes (move a passenger, let someone drive or not, take someone out) live only in the URL, so a link shares the plan and nothing is stored. Export as CSV.
  - `/leitendenbereich/abrechnung`: list of the CampFlow Aktionen (current/archived, search); each opens `/leitendenbereich/abrechnung/<evt_id>` (rewrite to `abrechnung/detail` in `staticwebapp.config.json`, mirrored in `astro.config.mjs` for dev), which replaces the Excel „Abrechnungsmappe“ with four tabs: Übersicht, Teilnehmende, Einzelnachweise and Leihgebühren. API: `GET /api/intern/abrechnung/{evt_id}` (optional `?kostenstelle=<name or cun_…>`), `GET /api/intern/abrechnung/kostenstellen`, `POST /api/intern/abrechnung/{evt_id}/kjr-liste`, `GET /api/intern/abrechnung/belege/{nummer}/bild?page=n`.
    - **Tabs:** Teilnehmende lists the confirmed registrations with only the fields relevant for the Abrechnung (name, m/w/d, age, PLZ, KJR role and Wohnort), Betreuer*innen above the Teilnehmende like in the KJR's list, the Wohnort from CampFlow and whether and why the KJR subsidises each person; the Postleitzahl can be changed per person (it decides the subsidy and goes into the KJR list and the PDF; the Wohnort then follows it, as it does for added persons); persons can be left out or added, and „Zurücksetzen“ restores the list from CampFlow (also in the tab Leihgebühren, whose title shows the sum once something is entered). Einzelnachweise lists every income and expense, filtered by Kategorie and income/expense. Both lists export as PDF in the browser (jsPDF, loaded only on export; `web/src/lib/abrechnungPdf.ts`).
    - **PDFs** (all A4 portrait, built in the browser): the Teilnehmende list; the Einzelnachweise as a list only or with every receipt on its own page (details on top, the image below, for stapling the original receipt to it); the Deckblatt of the Mappe (counts, „Vorkalkulation von“, „Abschließende Kalkulation von“); the Leihgebühren letter with the letterhead of the Mappe and the Vorstände of the Leitungsteam „Vorstand“ (`/api/vorstand`).
    - **Receipt images:** `GET /api/intern/abrechnung/belege/{nummer}/bild?page=n` passes the PNG of one receipt page from the playwright-api through, with the page count in `x-campflow-pages`. The browser loads three at a time, so no single request runs into the timeout of the Functions.
    - **Postleitzahlen → Orte:** `web/public/abrechnung/plz-orte.json` (about 70 KB gzipped, loaded only when needed) lists the Gemeinden of every German Postleitzahl. It is built by `bun scripts/plz-orte.ts <streets.updated.csv>` in `web/` from the street list of [openpotato/openplzapi.data](https://github.com/openpotato/openplzapi.data) (data © OpenStreetMap contributors, ODbL; the derived file is under the ODbL as well). Rebuild it about once a year. The subsidy still only depends on the KJR's Postleitzahlen in `api/lib/kjr-zuschuss.ts`.
    - **(ich):** names in the Teilnehmende, the Auslagen and the Einzelnachweise that match the `name` claim of the logged-in user are marked with „(ich)“ (`isOwnName`).
    - **Auslagen:** the Übersicht sums the expenses per „Auslage durch“, the money the Kasse pays back to each person (like „Übersicht Auslagen“ in the Mappe; the virtual Leihgebühren are not included, they come from the Sparbuch).
    - **Materialleihgebühren:** the tab „Leihgebühren“ rebuilds the sheet of the Mappe (days preset with the days of the KJR grant). The material, its fees per day and the date of the decision (`stand`) are in `CONFIG.abrechnung.leihgebuehren` (`api/lib/config.ts`) and come with `GET /api/intern/abrechnung/{evt_id}`; when new fees are decided, change them there and keep the `id` of items that stay. The sum counts as a virtual expense of category Unterkunft in the Übersicht and the Einzelnachweise, and the grant is computed on the deficit after it. The target is Einnahmen − Ausgaben − Leihgebühren + Zuschuss ≈ 0 € (±100 €). The entries are not stored: the PDF is uploaded to CampFlow as a receipt (Unterkunft, ausgelegt von Sparbuch) and appears as a real Einzelnachweis after a reload.
    - **Not stored:** left-out and added persons, the Zusatztag, the roles chosen for persons under 27, changed Postleitzahlen, the header of the KJR list, the Leihgebühren and the names of the Deckblatt live only in memory while the page of the Aktion is open (`abrechnungSession` in `web/src/lib/abrechnungStore.svelte.ts`). With any of them entered, leaving or reloading the page asks first (`guardUnsavedChanges`); after leaving, the Aktion starts empty again. The counts, the grant and the KJR list use this adjusted list.
    - **Sources:** the participants come from the CampFlow API. The Einzelnachweise (Kasse → Auswertungen) come from our [playwright-api](https://github.com/stamm-phoenix/playwright-api) (`GET /campflow/einzelnachweise?costUnit=…`), because the CampFlow API has no finance endpoints. The playwright-api keeps the last export; opening a page uses it, „Neu laden“ sends `?refresh=true` (passed on as `refresh=true`) for a new export. The Übersicht shows when the Einzelnachweise were exported (`exportedAt`).
    - **Configuration:** the playwright-api URL is `CONFIG.playwrightApi.url`; the app setting `PLAYWRIGHT_API_KEY` must be one of the keys in its `API_KEYS`.
    - **Kostenstelle:** CampFlow reports filter by Kostenstelle, not by event. The API looks up the Kostenstelle with the event's title. If there is none, the page offers the list of Kostenstellen and keeps the choice in the URL.
    - **Persons:** only confirmed registrations count, with their age on the first day. From 27 on, the KJR only accepts them as Betreuer*innen (fixed, also in `POST …/kjr-liste`); younger Leitende can be entered as Betreuer*in in the tab Teilnehmende (`isKjrBetreuer` in `api/lib/kjr-zuschuss.ts`). A Betreuungsschlüssel worse than 1:8 is marked, because it has to be explained in the application; without anybody from 27 the page asks to enter at least one Betreuer*in.
    - **Landkreis:** the KJR only subsidises Teilnehmende with a Postleitzahl in the Landkreis Rosenheim (list in `api/lib/kjr-zuschuss.ts`, taken from the KJR's template); Betreuer*innen always count. The page says how many Teilnehmende are left out.
    - **Teilnahmeliste:** `POST /api/intern/abrechnung/{evt_id}/kjr-liste` with the persons of the page (validated; role and Wohnort are derived on the server) and `ort`, `plz`, `beginn`, `ende` fills the KJR's Excel template (`api/assets/kjr-teilnahmeliste.xlsx`, Stand 05/2024) with these persons: from 27 in part I with „ja“ as ehrenamtlich, the others in part II. Each person gets the nights without Zusatztag (at most 13, or one day of presence without overnight stay) in the column for where they live. Only input cells are written; the template's formulas recalculate when the file is opened. When the KJR publishes a new template, replace the file and check the cell positions in `api/lib/kjr-teilnahmeliste.ts`.
    - **Calculation:** income and expenses are summed per category. The KJR grant (`api/lib/kjr-zuschuss.ts`, shared with the page) is 8 € × subsidised persons × overnight stays (+1 with the checkbox „Zusatztag“), or 5 € × persons for an Aktion without overnight stay. It only counts for a deficit and at most up to its amount. The checkbox is not stored.
    - **Data:** of the CampFlow registrations only the fields above leave the API; addresses, birthdates and contact data stay in CampFlow.
    - **Side effect:** each request takes about five seconds and creates a report in CampFlow (`finance_reports`), like clicking „Exportieren“.
  - `/leitendenbereich/belege`: Leitende photograph receipts and submit them with shop, date, amount, who paid, whether it is paid back and the Aktion (suggestions from CampFlow). This is only an upload and pre-check without needing a CampFlow account; the bookkeeping itself happens in CampFlow. The Kasse (logins in `CONFIG.belege.reviewers`; if empty, every leader) sees all receipts and accepts or rejects them; other leaders see only their own receipts, can correct them and resubmit rejected ones. The Kasse accepts a receipt or rejects it with a reason (`Eingereicht` → `Angenommen` / `Abgelehnt`); rejecting mails the reason to the uploader from `CONFIG.mail.belegeSender` (Graph `Mail.Send`; without it no mail is sent and the page says so), who can correct and resubmit it. Accepted receipts are downloaded with a descriptive file name, uploaded to CampFlow by hand and then deleted (`/api/intern/pflege/belege`); the CampFlow API has no endpoint for receipts yet. Photos are scaled to at most 2000 px JPEG in the browser, which also warns about dark or blurry photos. The page recommends the phone's own document scanner; for plain photos the browser works like a scan app (`web/src/lib/belegScan.ts`): it finds the receipt's corners (adjustable by drag or arrow keys), straightens it and evens out shadows and exposure (colour, greyscale or unchanged). Scan and original are stored side by side as attachments `beleg-<time>-scan.jpg` and `beleg-<time>-original.jpg`; the image column shows the scan; the API rejects photos with less than 800 px on the long edge. Optionally an image model on Azure OpenAI pre-checks each photo (receipt? complete? readable?) and prefills shop, date and amount; setup and cost limits: [docs/belege-ki-pruefung.md](docs/belege-ki-pruefung.md). See "Edited SharePoint lists" below.
  - `/leitendenbereich/gruppenstunden`, `/leitendenbereich/leitende`, `/leitendenbereich/downloads`: edit modules for the SharePoint lists behind the public pages (`/api/intern/pflege/*`). Changes are visible on the website immediately. See "Edited SharePoint lists" below.
- **App registration:** the login reuses the existing registration (App Settings `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`, read by the SWA login; keep both in Azure). It needs a _Web_ platform with the redirect URI `https://<domain>/.auth/login/aad/callback` and ID tokens enabled. Preview environments are added and removed automatically by the deploy workflow (one-time setup: [docs/entra-preview-login.md](docs/entra-preview-login.md)); `AZURE_CLIENT_SECRET` must hold a valid client secret.
- **Local testing:** `just dev-full`, then open http://localhost:4280/leitendenbereich. The SWA CLI shows a mock login: use provider `aad` and role `authenticated`. If you add a `tid` claim, it must match `CONFIG.azure.tenantId`.

### Edited SharePoint lists

| List / library | Columns | Notes |
| --- | --- | --- |
| Gruppenstunden (`CONFIG.sharepoint.lists.gruppenstunden`) | `Title` (Stufe), `Wochentag`, `Zeit`, `Alter`, `Ort`, `Beschreibung` (rich text) | `Title` must equal a `Team` value of the Leitende list, otherwise no leaders are shown for the group |
| Aktionen (`CONFIG.sharepoint.lists.calendar`) | `Title`, `Stufen` (multi-choice, incl. `Leitende`), `Beschreibung` (rich text), `Start`, `End` (date), `CampFlow_x002d_Anmeldung` (hyperlink), `CampFlowId` (text, `evt_…`, optional) | Entries with `CampFlowId` show the CampFlow title, dates and link; entries only for `Leitende` appear only in `leitende.ics`. Existing entries can be linked in the module |
| Leitende (`CONFIG.sharepoint.lists.leitende`) | `Title` (name), `Team` (multi-choice), `Telefon`, `Adresse` (location), `Image0` (image) | Phone and address are only shown publicly for `Vorstand`. New teams are added as choice values in SharePoint |
| Downloads (`CONFIG.sharepoint.downloadFilesDriveId`) | files in the root folder | Deleted files go to the site's recycle bin |
| Belege (`CONFIG.sharepoint.lists.belege`) | `Title` (shop), `Belegdatum` (text, `YYYY-MM-DD`), `BetragCent` (number), `BezahltVon` (text), `Auszahlung` (Yes/No, the uploader wants the money back), `Aktion` (text), `Bemerkung`, `Pruefnotiz` (multiple lines, plain text), `Status` (choice: `Eingereicht`, `Angenommen`, `Abgelehnt`), `EingereichtVon` (text, login of the uploader), `Beleg` (image), `KiPruefung` (multiple lines, plain text JSON, optional) | Create the columns with these internal names. Receipts hold personal and financial data: restrict the list's SharePoint permissions to the Kassenteam; the website reads it with the app registration. Deleted receipts go to the site's recycle bin |


- Graph cannot write location and image columns or attachments, so `Adresse`, `Image0`, `Beleg` and the photo attachments are written through the SharePoint REST API (`api/lib/sharepoint-rest.ts`). The app registration therefore needs **SharePoint** write permission in addition to Graph.
- Saving sends the item's `etag`; if someone else changed the item in the meantime, the API answers `409 CONFLICT` instead of overwriting.
- Download uploads use a Graph upload session: the API returns a short-lived upload URL and the browser sends the file directly to SharePoint.
- SharePoint records the app as editor; every change is logged with the acting user (`[pflege] …` in the Functions logs).

## Styling

- Global theme tokens, gradients, and utility classes are defined in `web/src/styles/global.css`
- Base layout and shell: `web/src/layouts/BaseLayout.astro`; navigation/footer in `web/src/components/`

## Testing

- Build validation: `bun run build` (in `web/` and `api/`)

### Sammelbestellungen (Rüsthaus and Ausrüster Eschwege)

Leaders create campaigns at `/leitendenbereich/sammelbestellungen`, choose the order window and edit the starting selection of common Rüsthaus articles. The default selection follows the historical Stamm article list and contains 23 verified shop products, including shirts/blouses, the rdp neckerchief, knots, badges, a belt, a scout hat, Rover clothing and the DPSG order book. The mapping and unresolved old articles are documented in [standard article mapping](docs/sammelbestellung-standardartikel.md). It contains no cached prices or stock information. Members can also enter articles from Rüsthaus and Ausrüster Eschwege by article number or HTTPS product link, with their name, size/variant and quantity. Links identify the supplier automatically; plain article numbers use the selected supplier. Supplier identity is stored inside the existing JSON columns, so no new SharePoint columns are needed. Old entries without a supplier default to Rüsthaus. Aggregation keeps identical article numbers from different suppliers separate; CSV exports can contain all suppliers or only Rüsthaus or Eschwege. Confirmation mails identify each item’s supplier.

The leader overview lists campaigns with their order window, open/closed status and archive status. Each campaign opens at `/leitendenbereich/sammelbestellungen/<id>`, so the same detail view opens after a reload or when sharing the URL with other leaders. Existing `?id=<campaign-id>` overview links redirect to the detail URL. Use `Neu laden` to fetch the latest campaigns on the overview or the latest orders on the detail page.

Because the frontend is static, Azure rewrites these detail URLs to the shared `sammelbestellungen/detail/index.html` page, with the same authentication and private-page headers as the leader area. The browser loads the campaign by its numeric path ID. The Astro development integration mirrors this rewrite locally. No private campaign data is loaded at build time.

Campaigns have an `Archiviert` Yes/No column, defaulting to No. Leaders can switch between the current list and the archive, archive a campaign or restore it from either the overview or its detail page with version-checked actions. Existing rows without a value are treated as current. Archiving retains all orders and personal order views, but closes invitations, new orders, member edits and product lookups. Restoring only reopens member access if the original order window is still open.

Campaign openness is checked when each member request is admitted. Archiving or reaching the deadline rejects requests that observe the closed campaign. Requests already admitted may finish their order write or email delivery after closure; archiving does not cancel them. SharePoint does not provide a transaction across the campaign and its order rows, so this workflow does not promise immediate revocation of in-flight requests. A concurrent staff change to an individual order still invalidates the member's loaded ETag and prevents that stale order write.

The individual order overview supports combined filters for `Eingereicht`, a missing final amount (`Noch offen`), unpaid and undelivered orders. Completed orders (arrived, priced, paid and delivered) and cancellations are hidden by default and can be shown with a checkbox. These display filters do not change the CSV exports or the combined purchasing list.

Leaders can use `Nachricht schreiben` on an individual order to send a formatted message to its stored email address. The dialog uses the existing rich-text editor and the mail uses the shared Phoenix layout, includes the personal order link and is signed with the acting leader's first name. Replies go to `CONFIG.mail.sammelbestellungSender`; messages remain in that mailbox's sent items. The server validates and sanitizes the message, checks the loaded order version, and logs the acting user. Cancelled orders can still be contacted when shown in the overview.

When members enter a supported product URL, the Functions API reads its product name, image and indicative unit price from Rüsthaus Open Graph metadata or Eschwege product/offer microdata. Both shops expose indicative schema.org availability, with unknown stock explicitly marked; availability does not guarantee a particular size or variant. Eschwege special offers use the current offer price rather than the crossed-out previous price. The editor shows a preview and automatically fills an empty article name after a successful lookup. Later product-link changes update a name only while it still matches the previous lookup result; member-entered names are preserved even when requests finish late. The product reference appears before the name field. Product previews are not stored as final prices or in SharePoint; the fetched name becomes part of the editable draft and is persisted only when the member saves the order. Missing metadata or shop errors leave manual entry available. Lookup requires a valid personal order link and an editable order. It accepts only HTTPS product URLs on the exact Rüsthaus and Ausrüster Eschwege hosts, checks every redirect and rejects cross-supplier redirects, limits page size and request time, and caches successful results for 15 minutes. Each order can make 80 lookups per minute per Functions instance, covering up to 30 catalog previews, 40 order rows and a few retries. Preview images are restricted to the corresponding supplier’s product-image paths and loaded without a referrer. Eschwege session IDs and cart-action query parameters are removed before fetching or saving product references.

The staff detail page also fetches indicative unit prices from saved product URLs through a staff-authenticated endpoint. It deduplicates references and runs at most four lookups concurrently, using the same restricted shop fetch and cache. Existing orders need no additional SharePoint columns. Order cards show line amounts and a shop subtotal; the combined purchase list and CSV show suppliers, unit prices, line amounts and a receipt total. The CSV supplier selection recalculates its total using only the exported items. Missing prices withhold the complete total and show a clearly marked subtotal of known prices instead. The total stays visible below the table on mobile. Article numbers alone cannot supply automatic prices. These are current shop prices without shipping; variant prices must be checked. Staff-maintained final order amounts remain independent of these estimates.

The **Sammelbestellung freigeben** button loads current CampFlow members, includes their documented `primary_email` and `cc_emails` fields, and deduplicates normalized addresses. The confirmation names the exact recipient count. A changed audience requires a new confirmation. The `Einladungsversand` campaign column (multiple lines of plain text, initially blank) stores the recipient snapshot and delivery progress; add it to existing lists before using release. Sending advances one durably reserved recipient per request and can be continued after closing the page. ETags prevent duplicate sends across tabs and server instances. A failed or uncertain delivery is not retried automatically; check the sender mailbox. Inviting does not change the existing order window.

Excluded items remain stored in the existing `Artikel` JSON with their optional reason, visible to members and leaders, and excluded from purchase exports and receipt sums. Members cannot change or remove these rows. Leaders can restore them; either change resets the final amount/payment marker and attempts a notification mail. Notification failures are reported after saving; use **Nachricht schreiben** to contact the family.

Copy the campaign's **shared invitation link** into the same CampFlow email for all members. The page asks for an email address and sends a personal order link through Microsoft Graph. CampFlow does not need to personalize links. Possession of the shared link grants permission to request an order link; there is no automatic check against the CampFlow membership list, so distribute it only to members. One normalized email address has one order per campaign, including a shared family order for siblings.

Campaign invitations and new orders are accessible only during the configured period. Personal links keep showing the order after the deadline, but changes are rejected. Leaders lock an individual order by setting `Bestellt`, `Eingetroffen` or `Storniert`. Both member edits and staff status changes use SharePoint ETags, so a simultaneous member edit cannot overwrite a staff lock. Setting `Eingereicht` explicitly reopens that order while the period is still open. A member edit clears a previously recorded total and payment flag because the ordered articles may have changed.

The leader overview includes submitted orders, a combined purchasing list grouped by product link or article number and variant, and CSV downloads for both. Different names for the same reference and variant are combined; the first encountered name is displayed. Different variants remain separate. Drafts and cancelled orders are excluded from the combined list. Leaders record the final total in euros and check payment and delivery manually. `Bezahlung verwalten` supports explicit CampFlow person assignment, guarded contribution creation and audited adoption of existing contributions. Payment requests are sent in the CampFlow dashboard and payments are marked manually. Creation is disabled by default through `SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED`; configure the required payment columns and `PLAYWRIGHT_API_KEY` before enabling it. Missing cost centres and the “Bestellungen” category are created through the Playwright API before attempting the contribution; new categories use `business`, existing categories are preserved. Amounts, people and articles are locked once a contribution operation starts. Ambiguous results block further creation and require manual investigation. See the [CampFlow payment setup and recovery instructions](docs/sammelbestellung-campflow-zahlungen.md) for schema, limits and the remaining scope of [issue #89](https://github.com/stamm-phoenix/website-astro/issues/89).

#### Setup before deployment

After a member submits or updates an order, the website sends a confirmation with the saved articles, variants, quantities, notes and personal order link. A failed email does not undo the saved order; the member receives an explicit notice on the website. Confirmation emails are sent only after a successful version-checked write.

Member edits are saved only with `Bestellung abgeben` or `Änderungen speichern`. The editor compares the current name, notes and article rows with the loaded order, marks unsaved changes and disables saving when nothing changed. Restoring the loaded values clears that mark; a failed save retains it.

Create two SharePoint lists in the configured site with these **internal column names**. Create the columns with these names first; display labels can be renamed afterwards. JSON columns must be plain-text multiple-line columns, without append-only history or rich text.

| List / setting                                              | Columns                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campaigns (`CONFIG.sharepoint.lists.sammelbestellungen`)    | `Title` (text), `Beschreibung` (multiple lines), `Beginn`, `Ende` (text, UTC ISO timestamps), `Katalog` (multiple lines, JSON), `CreationKey` (text, **enforce unique values**), `Archiviert` (Yes/No, default No), `LinkversandLimit` (multiple lines, plain text JSON, optional, initially blank), `Einladungsversand` (multiple lines, plain text JSON, optional, initially blank)                 |
| Orders (`CONFIG.sharepoint.lists.sammelbestellungenOrders`) | `Title` (text, **not required**, initially blank), `Email` (text), `AktionId` (text, **indexed**), `OrderKey` (text, **enforce unique values**), `Artikel`, `Bemerkungen` (multiple lines), `Status` (choice: `Eingereicht`, `Bestellt`, `Eingetroffen`, `Storniert`), `Eingereicht`, `Bezahlt`, `Ausgeliefert` (Yes/No), `BetragCent` (number, optional), `LinkGesendetAm` (text, UTC ISO timestamp) |

`OrderKey` is a campaign ID plus a hash of the normalized email. Its database uniqueness constraint prevents duplicate orders even when two requests race. `CreationKey` likewise prevents retrying the same create form from creating another campaign. Both constraints are required, not just indexes. Set the list IDs in the Functions application settings and `api/local.settings.json`; see `api/local.settings.example.json`.

Also configure:

- `SAMMELBESTELLUNG_LINK_SECRET`: a random secret of at least 32 characters, e.g. generated with `openssl rand -hex 32`. Use a distinct secret per environment and keep it stable across redeployments. HMAC tokens are domain-separated between campaign invitations and personal order links. Rotating this secret invalidates all previous links.
- `CONFIG.mail.sammelbestellungSender` in `api/lib/config.ts`: the sender mailbox. Microsoft Graph application permission `Mail.Send` and access to that mailbox are required. Nikolaus continues to use its existing sender setting.

Links carry tokens in URL fragments, never query parameters. The browser sends them only in JSON request bodies and keeps the current link in session storage for tab-local reloads and skip-link navigation. Member pages are excluded from the sitemap and have `noindex`, `no-store` and `no-referrer` route headers. All new API responses, including errors, use `no-store`. Link requests use a honeypot and a 15-minute per-order cooldown reserved with an ETag. Mail failures clear that reservation without invalidating existing links.

The campaign's `LinkversandLimit` JSON stores an ETag-protected request quota shared by all recipients and server instances. At most 100 accepted link requests per UTC clock hour and 500 per UTC day can proceed to order creation and mail delivery. Retries, per-order cooldown hits and failed deliveries consume quota too; failed attempts are not refunded. Expired windows reset automatically. Repeated ETag contention returns 429 without creating an order or sending mail. Reaching a quota emits a campaign-only log entry, without recipient addresses. Staff can block admission of further requests by archiving a campaign; already admitted requests may finish as described above. Add this column to existing lists before deploying; do not clear active quota counters. This campaign quota does not replace a sender-wide edge limit across campaigns or the trusted Azure SWA ingress that protects identity headers.

Stored catalogs and order items are validated when read. Invalid JSON or invalid article shapes return `INVALID_STORED_DATA` with the affected SharePoint item ID and column; purchasing lists and exports remain unavailable until the field is corrected. Items are never silently replaced with an empty list. Only an unsubmitted order may have an explicitly empty `Artikel` array.

Order rows allow at most 40 articles with quantities from 1 to 99; the common selection allows at most 30 articles. Times entered by leaders and displayed deadlines use Europe/Berlin, independent of the browser timezone, and are stored in UTC. Nonexistent times during the daylight-saving change are rejected. Campaign definitions are fixed after creation in this first implementation; corrections can be made in SharePoint. Remove old orders from the production lists under the tribe's retention policy. Personal links stop resolving when their order or campaign is deleted.

API tests use simulated SharePoint and mail responses. For local browser testing use the SWA CLI with an `aad`/`authenticated` mock staff login. Never send test emails to real members or create real CampFlow contributions. If testing against the real SharePoint lists, follow the repository rule to name test data `TEST – bitte löschen` and delete it immediately afterwards.
