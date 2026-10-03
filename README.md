# Stamm Phoenix Website

Modern site for the DPSG Stamm Phoenix (Feldkirchen-Westerham) built with Astro and Tailwind. The site currently lives at [stamm-phoenix.de](https://stamm-phoenix.de) and is deployed via Azure Static Web Apps.

> Canonical URLs, Open Graph tags, sitemap, and robots.txt always use `https://stamm-phoenix.de` (`site` in `web/astro.config.mjs`), also in preview builds, so previews are not indexed as separate pages. Links in mails use the address the request was sent to (production, preview or localhost, see `api/lib/site-url.ts`), so no site URL needs to be configured per environment.

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
# Fill in the credentials and list IDs in api/local.settings.json.
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
traces are in `web/test-results/artifacts/`. The suite uses its own server on port
4323 and refuses to reuse a running server. On NixOS, set
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
- `/aktionen` – upcoming events with group filters; detail pages at `/aktionen/[uid]`
- `/mitmachen` – embeds the Campflow membership form (requires JS)
- `/fragen-und-antworten` – categorized FAQs from SharePoint
- `/kontakt` – contact details
- `/nikolaus` – Nikolausdienst Q&A and booking (only linked while `publicActive`); `/nikolaus/termin` lets families manage their booking
- `/impressum` – legal information

## Fragen & Antworten (`/fragen-und-antworten`)

Logged-in staff can create, edit and delete FAQ entries at
`/leitendenbereich/fragen-und-antworten`, available through the "Fragen & Antworten"
module. The editor supports questions, optional categories (default: `Allgemein`)
and formatted answers. Both free-text categories and configured SharePoint choice
values are supported, including whether fill-in choices are allowed. New entries
start as drafts and may have an empty answer. Only published entries with a
question and answer appear in the public FAQ. Unchecking "Veröffentlicht" hides
an entry without deleting it; checking it again publishes it. Incomplete existing
rows can also be repaired in the editor.
`/api/intern/pflege/qa` uses the existing staff authentication, validation and audit
logging. Updates and deletes require the loaded ETag and return HTTP 409 if the
entry has changed. No additional list or environment setting is required.

The public `GET /api/qa` endpoint reads a dedicated SharePoint Q&A list. Set
`SHAREPOINT_QA_LIST_ID` in `api/local.settings.json` for local development and in
Azure application settings for both preview and production environments. The
existing SharePoint authentication and site settings are also required.

Create columns with the internal names `Title` (question), `Antwort` (answer,
plain or rich text), `Kategorie` (text or choice), and `Veroeffentlicht` (yes/no,
display name "Veröffentlicht", default Yes). Before deploying this change, add
`Veroeffentlicht` to the existing FAQ list and set existing entries to Yes so
currently visible answers remain published. Create the column using its internal
name first, then rename its display name. New entries created through the editor
explicitly store No. Rows without a status remain published for compatibility
with existing data; false statuses are excluded by the public API. Blank
categories appear under "Allgemein"; rows without a question or answer are skipped.
Answers are sanitized before rendering.

## Nikolausdienst (`/nikolaus`)

Families book a 30-minute Nikolaus visit online; bookings are stored in a SharePoint list via the API (`api/endpoints/nikolaus-*.ts`).

- **Config:** `api/lib/nikolaus-config.ts` (also imported by the frontend) – two on/off switches (`staffActive` for the Leitendenbereich, `publicActive` for everything families see), days, teams per day, start/end time, reservation hold time, change deadline (`changeDeadlineHours`, default 24 h before the appointment). Changes take effect with the next deployment. With `publicActive: false` the nav entry and homepage banner disappear, `/nikolaus` only shows the Q&A and the API rejects bookings; with `staffActive: true` the team can already plan in the Leitendenbereich.
- **Flow:** a booking reserves its slot for `pendingHoldMinutes` (status `Ausstehend`) and sends a mail linking to `/nikolaus/termin#token=…`. On this management page the family confirms (`Bestaetigt`), changes their details, moves the booking to another free slot or cancels (`Storniert`). Changes and cancellations are only possible until the change deadline. Unconfirmed reservations expire (`Abgelaufen`).
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

- **Shared state and operation:** Before deployment, create the shared state list with a unique indexed `OperationKey` text column and a plain multiline `State` column. Set `SHAREPOINT_NIKOLAUS_STATE_LIST_ID` and the same `NIKOLAUS_STATE_SECRET` (at least 32 characters) for production and every preview. `NIKOLAUS_MAIL_HOURLY_LIMIT` / `NIKOLAUS_MAIL_DAILY_LIMIT` default to 100 / 500 admitted sends per sender in UTC windows. Management writes use the loaded ETag; new mail links use fragments and older query links remain compatible. The daily automatic retention workflow is prepared but disabled until explicitly configured; Nico Welles reviews results one calendar month after the final season visit. See the [operation, Azure measurements and retention runbook](docs/nikolaus-betrieb.md).
- **API environment variables:** `SHAREPOINT_NIKOLAUS_LIST_ID`, `NIKOLAUS_MAIL_SENDER` (mailbox the mails are sent from), `SHAREPOINT_NIKOLAUS_DISPO_LIST_ID` and `OPENROUTESERVICE_API_KEY` (Dispo, see below).
- **Dispo (`/leitendenbereich/nikolaus-dispo`):** distributes the confirmed bookings of a day to the teams (A–D, as many as `teams` of the day in `nikolaus-config.ts`, colours in `NIKOLAUS_TEAMS`). `GET /api/intern/nikolaus/dispo?date=` returns the bookings, a driving-time matrix (OpenRouteService with `OPENROUTESERVICE_API_KEY`, otherwise estimated from the air-line distance) and the saved Dispo; the browser calculates the routes with `api/lib/nikolaus-dispo.ts` (visit = children × 5 min, at least 10 min; rated by driving time and delays against the booked slot). `PUT /api/intern/pflege/nikolaus-dispo?date=` saves it. For the map, `POST /api/intern/nikolaus/dispo/routes?date=` returns each team's course along the roads (OpenRouteService directions, cached; straight lines without the service). New saves use an atomic versioned snapshot in the shared state list; see [planning migration and recovery](docs/nikolaus-planungen.md). The legacy SharePoint list „Nikolaus-Dispo“ has one row per planned booking:

  | Column | Type |
  | --- | --- |
  | `Title` | Single line of text (booking ID) |
  | `Datum` | Single line of text, indexed (`YYYY-MM-DD`) |
  | `Team` | Choice: `A`, `B`, `C`, `D` |
  | `Reihenfolge` | Number |
  | `SlotKey` | Single line of text (slot of the booking when saved) |
  | `GeplanteAnkunft` | Single line of text (`HH:MM`) |
  | `Fixiert` | Yes/No (set by hand, kept when recalculating) |
  | `Besucht` / `BesuchtUm` | Yes/No / Single line of text (for the team view, not used yet) |
- **Internal tags:** the booking list has a column `InterneTags` (single line of text, comma separated), edited in the booking details (`PUT /api/intern/pflege/nikolaus-bookings/{id}/tags`). The tags are only returned by the staff endpoints, never in mails or `/api/nikolaus/manage/*`, and are copied when a booking is moved.
- **Helfende and Einteilung (`/leitendenbereich/nikolaus-helfende`):** helpers volunteer per day for Nikolaus, Krampus, Fahrer*in, Engerl (one each per team) or Küche. `api/lib/nikolaus-einteilung.ts` (shared with the browser) solves all days as one min-cost flow: filled posts by importance first, then spreading the workload over more people, then positive tags. A helper with a negative tag is never put in a team whose route (saved Dispo) has a family with that tag; Dispo recalculation keeps such families away from teams with such helpers. Volunteers for Küche who are not needed in a team work in the kitchen; the rest of the day's volunteers are shown as „Ohne Aufgabe“. Endpoints: `GET /api/intern/nikolaus/helfende`, `POST`/`PATCH`/`DELETE /api/intern/pflege/nikolaus-helfende[/{id}]`, `GET /api/intern/nikolaus/einteilung`, `PUT /api/intern/pflege/nikolaus-einteilung`. Lists:

  | List | Columns |
  | --- | --- |
  | „Nikolaus-Helfende“ (`SHAREPOINT_NIKOLAUS_HELFENDE_LIST_ID`) | `Title` (name), `Verfuegbarkeit` (multiple lines, JSON day → posts), `TagsPositiv`, `TagsNegativ` (comma separated), `Bemerkungen` |
  | „Nikolaus-Einteilung“ (`SHAREPOINT_NIKOLAUS_EINTEILUNG_LIST_ID`) | `Title` (name of the helper, only for reading the list), `HelferId` (number, ID in „Nikolaus-Helfende“ – the key), `Datum` (indexed), `Team` (choice A–D, Küche), `Posten` (choice), `Fixiert` (Yes/No) |
- **Test data:** `cd api && bun scripts/nikolaus-testdata.ts` fills every free place of the configured slots with invented, confirmed families (invented local addresses and synthetic coordinates, e-mails `@nikolaus-test.invalid`, phone numbers from the Bundesnetzagentur fiction range (089) 99998-xxx). `--dry-run` only shows them, `--delete` removes all test bookings and their Dispo rows again – run it before going live. About a quarter of the families get a group tag. `--helfende` (with `--dry-run`/`--delete`) does the same for about 30 invented helpers, marked with `[Test]` in their notes. Uses `api/local.settings.json`.
- **App registration permissions:** write access to the site (`Sites.ReadWrite.All`, or `Sites.Selected` with role `write`) and application permission `Mail.Send` (ideally restricted to the sender mailbox).
- **Local testing:** copy `api/local.settings.example.json` to `api/local.settings.json`, fill it in, run `just dev-full` and open http://localhost:4280.

## Leitendenbereich (`/leitendenbereich`)

Internal area for leaders, only reachable with a Microsoft account of the Stamm Phoenix tenant.

- **Login:** Static Web Apps custom Entra ID provider (Standard plan), configured in `web/public/staticwebapp.config.json`. The `openIdIssuer` contains our tenant ID, so only accounts of our organisation can sign in. `/login` and `/logout` are shortcuts, other providers (GitHub, Twitter) are blocked.
- **Protection:** the routes `/leitendenbereich/*` and `/api/intern/*` require the role `authenticated`; anonymous visitors are redirected to the login. Every `/api/intern/*` endpoint additionally calls `requireStaff()` (`api/lib/staff-auth.ts`), which checks the `x-ms-client-principal` header and compares the tenant claim with `AZURE_TENANT_ID` when one is present (in Azure, SWA does not forward claims to the API; the tenant is enforced by the login).
- **Modules:** tiles on the start page come from `STAFF_MODULES` in `web/src/lib/staffModules.ts`; the Nikolaus pages (`NIKOLAUS_MODULES`) have their own section „Nikolaus“, shown while `staffActive` is set.
  - `/leitendenbereich/nikolaus`: read-only list/matrix of the Nikolaus bookings (`GET /api/intern/nikolaus/bookings`).
  - `/leitendenbereich/nikolaus-dispo`: distribution of the visits to the teams with routes, map and print view (see "Nikolausdienst" above).
  - `/leitendenbereich/nikolaus-helfende`: helpers and their distribution to the teams (see "Nikolausdienst" above).
  - `/leitendenbereich/aktionen`: read-only view of the CampFlow events (filtered by year) and their participants (`GET /api/intern/aktionen`, `GET /api/intern/aktionen/{evt_id}`). Needs the app setting `CAMPFLOW_API_TOKEN`. The API only sends GET requests to CampFlow and strips `bank_account` and `sepa_mandate` before the data reaches the browser. CampFlow does not expose a payment status.
  - `/leitendenbereich/belege`: Leitende photograph receipts and submit them with shop, date, amount, who paid, whether it is paid back and the Aktion (suggestions from CampFlow). This is only an upload and pre-check without needing a CampFlow account; the bookkeeping itself happens in CampFlow. The Kasse (logins in `BELEGE_REVIEWERS`, comma-separated; if empty, every leader) sees all receipts and accepts or rejects them; other leaders see only their own receipts, can correct them and resubmit rejected ones. The Kasse accepts a receipt or rejects it with a reason (`Eingereicht` → `Angenommen` / `Abgelehnt`); rejecting mails the reason to the uploader from `BELEGE_MAIL_SENDER` (Graph `Mail.Send`; without it no mail is sent and the page says so), who can correct and resubmit it. Accepted receipts are downloaded with a descriptive file name, uploaded to CampFlow by hand and then deleted (`/api/intern/pflege/belege`); the CampFlow API has no endpoint for receipts yet. Photos are scaled to at most 2000 px JPEG in the browser, which also warns about dark or blurry photos. The page recommends the phone's own document scanner; for plain photos the browser works like a scan app (`web/src/lib/belegScan.ts`): it finds the receipt's corners (adjustable by drag or arrow keys), straightens it and evens out shadows and exposure (colour, greyscale or unchanged). Scan and original are stored side by side as attachments `beleg-<time>-scan.jpg` and `beleg-<time>-original.jpg`; the image column shows the scan; the API rejects photos with less than 800 px on the long edge. Optionally an image model on Azure OpenAI pre-checks each photo (receipt? complete? readable?) and prefills shop, date and amount; setup and cost limits: [docs/belege-ki-pruefung.md](docs/belege-ki-pruefung.md). See "Edited SharePoint lists" below.
  - `/leitendenbereich/gruppenstunden`, `/leitendenbereich/leitende`, `/leitendenbereich/downloads`: edit modules for the SharePoint lists behind the public pages (`/api/intern/pflege/*`). Changes are visible on the website immediately. See "Edited SharePoint lists" below.
- **App registration:** the login reuses the existing registration (`AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`). It needs a *Web* platform with the redirect URI `https://<domain>/.auth/login/aad/callback` and ID tokens enabled. Preview environments are added and removed automatically by the deploy workflow (one-time setup: [docs/entra-preview-login.md](docs/entra-preview-login.md)); `AZURE_CLIENT_SECRET` must hold a valid client secret.
- **Local testing:** `just dev-full`, then open http://localhost:4280/leitendenbereich. The SWA CLI shows a mock login: use provider `aad` and role `authenticated`. If you add a `tid` claim, it must match `AZURE_TENANT_ID`.

### Edited SharePoint lists

| List / library | Columns | Notes |
| --- | --- | --- |
| Gruppenstunden (`SHAREPOINT_GRUPPENSTUNDEN_LIST_ID`) | `Title` (Stufe), `Wochentag`, `Zeit`, `Alter`, `Ort`, `Beschreibung` (rich text) | `Title` must equal a `Team` value of the Leitende list, otherwise no leaders are shown for the group |
| Leitende (`SHAREPOINT_LEITENDE_LIST_ID`) | `Title` (name), `Team` (multi-choice), `Telefon`, `Adresse` (location), `Image0` (image) | Phone and address are only shown publicly for `Vorstand`. New teams are added as choice values in SharePoint |
| Downloads (`SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID`) | files in the root folder | Deleted files go to the site's recycle bin |
| Belege (`SHAREPOINT_BELEGE_LIST_ID`) | `Title` (shop), `Belegdatum` (text, `YYYY-MM-DD`), `BetragCent` (number), `BezahltVon` (text), `Auszahlung` (Yes/No, the uploader wants the money back), `Aktion` (text), `Bemerkung`, `Pruefnotiz` (multiple lines, plain text), `Status` (choice: `Eingereicht`, `Angenommen`, `Abgelehnt`), `EingereichtVon` (text, login of the uploader), `Beleg` (image), `KiPruefung` (multiple lines, plain text JSON, optional) | Create the columns with these internal names. Receipts hold personal and financial data: restrict the list's SharePoint permissions to the Kassenteam; the website reads it with the app registration. Deleted receipts go to the site's recycle bin |

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

Leaders can use `Nachricht schreiben` on an individual order to send a formatted message to its stored email address. The dialog uses the existing rich-text editor and the mail uses the shared Phoenix layout, includes the personal order link and is signed with the acting leader's first name. Replies go to `SAMMELBESTELLUNG_MAIL_SENDER`; messages remain in that mailbox's sent items. The server validates and sanitizes the message, checks the loaded order version, and logs the acting user. Cancelled orders can still be contacted when shown in the overview.

When members enter a supported product URL, the Functions API reads its product name, image and indicative unit price from Rüsthaus Open Graph metadata or Eschwege product/offer microdata. Both shops expose indicative schema.org availability, with unknown stock explicitly marked; availability does not guarantee a particular size or variant. Eschwege special offers use the current offer price rather than the crossed-out previous price. The editor shows a preview and automatically fills an empty article name after a successful lookup. Later product-link changes update a name only while it still matches the previous lookup result; member-entered names are preserved even when requests finish late. The product reference appears before the name field. Product previews are not stored as final prices or in SharePoint; the fetched name becomes part of the editable draft and is persisted only when the member saves the order. Missing metadata or shop errors leave manual entry available. Lookup requires a valid personal order link and an editable order. It accepts only HTTPS product URLs on the exact Rüsthaus and Ausrüster Eschwege hosts, checks every redirect and rejects cross-supplier redirects, limits page size and request time, and caches successful results for 15 minutes. Each order can make 80 lookups per minute per Functions instance, covering up to 30 catalog previews, 40 order rows and a few retries. Preview images are restricted to the corresponding supplier’s product-image paths and loaded without a referrer. Eschwege session IDs and cart-action query parameters are removed before fetching or saving product references.

The staff detail page also fetches indicative unit prices from saved product URLs through a staff-authenticated endpoint. It deduplicates references and runs at most four lookups concurrently, using the same restricted shop fetch and cache. Existing orders need no additional SharePoint columns. Order cards show line amounts and a shop subtotal; the combined purchase list and CSV show suppliers, unit prices, line amounts and a receipt total. The CSV supplier selection recalculates its total using only the exported items. Missing prices withhold the complete total and show a clearly marked subtotal of known prices instead. The total stays visible below the table on mobile. Article numbers alone cannot supply automatic prices. These are current shop prices without shipping; variant prices must be checked. Staff-maintained final order amounts remain independent of these estimates.

The **Sammelbestellung freigeben** button loads current CampFlow members, includes their documented `primary_email` and `cc_emails` fields, and deduplicates normalized addresses. The confirmation names the exact recipient count. A changed audience requires a new confirmation. The `Einladungsversand` campaign column (multiple lines of plain text, initially blank) stores the recipient snapshot and delivery progress; add it to existing lists before using release. Sending advances one durably reserved recipient per request and can be continued after closing the page. ETags prevent duplicate sends across tabs and server instances. A failed or uncertain delivery is not retried automatically; check the sender mailbox. Inviting does not change the existing order window.

Excluded items remain stored in the existing `Artikel` JSON with their optional reason, visible to members and leaders, and excluded from purchase exports and receipt sums. Members cannot change or remove these rows. Leaders can restore them; either change resets the final amount/payment marker and attempts a notification mail. Notification failures are reported after saving; use **Nachricht schreiben** to contact the family.

Copy the campaign's **shared invitation link** into the same CampFlow email for all members. The page asks for an email address and sends a personal order link through Microsoft Graph. CampFlow does not need to personalize links. Possession of the shared link grants permission to request an order link; there is no automatic check against the CampFlow membership list, so distribute it only to members. One normalized email address has one order per campaign, including a shared family order for siblings.

Campaign invitations and new orders are accessible only during the configured period. Personal links keep showing the order after the deadline, but changes are rejected. Leaders lock an individual order by setting `Bestellt`, `Eingetroffen` or `Storniert`. Both member edits and staff status changes use SharePoint ETags, so a simultaneous member edit cannot overwrite a staff lock. Setting `Eingereicht` explicitly reopens that order while the period is still open. A member edit clears a previously recorded total and payment flag because the ordered articles may have changed.

The leader overview includes submitted orders, a combined purchasing list grouped by product link or article number and variant, and CSV downloads for both. Different names for the same reference and variant are combined; the first encountered name is displayed. Different variants remain separate. Drafts and cancelled orders are excluded from the combined list. Leaders record the final total in euros and check payment and delivery manually. `Bezahlung verwalten` supports explicit CampFlow person assignment, guarded contribution creation and audited adoption of existing contributions. Payment requests are sent in the CampFlow dashboard and payments are marked manually. Creation is disabled by default through `SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED`; configure the required payment columns before enabling it. Amounts, people and articles are locked once a contribution operation starts. Ambiguous results block further creation and require manual investigation. See the [CampFlow payment setup and recovery instructions](docs/sammelbestellung-campflow-zahlungen.md) for schema, limits and the remaining scope of [issue #89](https://github.com/stamm-phoenix/website-astro/issues/89).

#### Setup before deployment

After a member submits or updates an order, the website sends a confirmation with the saved articles, variants, quantities, notes and personal order link. A failed email does not undo the saved order; the member receives an explicit notice on the website. Confirmation emails are sent only after a successful version-checked write.

Member edits are saved only with `Bestellung abgeben` or `Änderungen speichern`. The editor compares the current name, notes and article rows with the loaded order, marks unsaved changes and disables saving when nothing changed. Restoring the loaded values clears that mark; a failed save retains it.

Create two SharePoint lists in the configured site with these **internal column names**. Create the columns with these names first; display labels can be renamed afterwards. JSON columns must be plain-text multiple-line columns, without append-only history or rich text.

| List / setting | Columns |
| --- | --- |
| Campaigns (`SHAREPOINT_SAMMELBESTELLUNGEN_LIST_ID`) | `Title` (text), `Beschreibung` (multiple lines), `Beginn`, `Ende` (text, UTC ISO timestamps), `Katalog` (multiple lines, JSON), `CreationKey` (text, **enforce unique values**), `Archiviert` (Yes/No, default No), `LinkversandLimit` (multiple lines, plain text JSON, optional, initially blank), `Einladungsversand` (multiple lines, plain text JSON, optional, initially blank) |
| Orders (`SHAREPOINT_SAMMELBESTELLUNGEN_ORDERS_LIST_ID`) | `Title` (text, **not required**, initially blank), `Email` (text), `AktionId` (text, **indexed**), `OrderKey` (text, **enforce unique values**), `Artikel`, `Bemerkungen` (multiple lines), `Status` (choice: `Eingereicht`, `Bestellt`, `Eingetroffen`, `Storniert`), `Eingereicht`, `Bezahlt`, `Ausgeliefert` (Yes/No), `BetragCent` (number, optional), `LinkGesendetAm` (text, UTC ISO timestamp) |

`OrderKey` is a campaign ID plus a hash of the normalized email. Its database uniqueness constraint prevents duplicate orders even when two requests race. `CreationKey` likewise prevents retrying the same create form from creating another campaign. Both constraints are required, not just indexes. Set the list IDs in the Functions application settings and `api/local.settings.json`; see `api/local.settings.example.json`.

Also configure:

- `SAMMELBESTELLUNG_LINK_SECRET`: a random secret of at least 32 characters, e.g. generated with `openssl rand -hex 32`. Use a distinct secret per environment and keep it stable across redeployments. HMAC tokens are domain-separated between campaign invitations and personal order links. Rotating this secret invalidates all previous links.
- `SAMMELBESTELLUNG_MAIL_SENDER`: the sender mailbox, e.g. `kontakt@stamm-phoenix.de`. Microsoft Graph application permission `Mail.Send` and access to that mailbox are required. Nikolaus continues to use its existing sender setting.

Links carry tokens in URL fragments, never query parameters. The browser sends them only in JSON request bodies and keeps the current link in session storage for tab-local reloads and skip-link navigation. Member pages are excluded from the sitemap and have `noindex`, `no-store` and `no-referrer` route headers. All new API responses, including errors, use `no-store`. Link requests use a honeypot and a 15-minute per-order cooldown reserved with an ETag. Mail failures clear that reservation without invalidating existing links.

The campaign's `LinkversandLimit` JSON stores an ETag-protected request quota shared by all recipients and server instances. At most 100 accepted link requests per UTC clock hour and 500 per UTC day can proceed to order creation and mail delivery. Retries, per-order cooldown hits and failed deliveries consume quota too; failed attempts are not refunded. Expired windows reset automatically. Repeated ETag contention returns 429 without creating an order or sending mail. Reaching a quota emits a campaign-only log entry, without recipient addresses. Staff can block admission of further requests by archiving a campaign; already admitted requests may finish as described above. Add this column to existing lists before deploying; do not clear active quota counters. This campaign quota does not replace a sender-wide edge limit across campaigns or the trusted Azure SWA ingress that protects identity headers.

Stored catalogs and order items are validated when read. Invalid JSON or invalid article shapes return `INVALID_STORED_DATA` with the affected SharePoint item ID and column; purchasing lists and exports remain unavailable until the field is corrected. Items are never silently replaced with an empty list. Only an unsubmitted order may have an explicitly empty `Artikel` array.

Order rows allow at most 40 articles with quantities from 1 to 99; the common selection allows at most 30 articles. Times entered by leaders and displayed deadlines use Europe/Berlin, independent of the browser timezone, and are stored in UTC. Nonexistent times during the daylight-saving change are rejected. Campaign definitions are fixed after creation in this first implementation; corrections can be made in SharePoint. Remove old orders from the production lists under the tribe's retention policy. Personal links stop resolving when their order or campaign is deleted.

API tests use simulated SharePoint and mail responses. For local browser testing use the SWA CLI with an `aad`/`authenticated` mock staff login. Never send test emails to real members or create real CampFlow contributions. If testing against the real SharePoint lists, follow the repository rule to name test data `TEST – bitte löschen` and delete it immediately afterwards.
