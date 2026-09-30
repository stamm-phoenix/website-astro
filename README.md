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

- **API environment variables:** `SHAREPOINT_NIKOLAUS_LIST_ID`, `NIKOLAUS_MAIL_SENDER` (mailbox the mails are sent from), `NIKOLAUS_SITE_URL` (base URL for mail links, e.g. `https://stamm-phoenix.de`), `SHAREPOINT_NIKOLAUS_DISPO_LIST_ID` and `OPENROUTESERVICE_API_KEY` (Dispo, see below).
- **Dispo (`/leitendenbereich/nikolaus-dispo`):** distributes the confirmed bookings of a day to the teams (A–D, as many as `teams` of the day in `nikolaus-config.ts`, colours in `NIKOLAUS_TEAMS`). `GET /api/intern/nikolaus/dispo?date=` returns the bookings, a driving-time matrix (OpenRouteService with `OPENROUTESERVICE_API_KEY`, otherwise estimated from the air-line distance) and the saved Dispo; the browser calculates the routes with `api/lib/nikolaus-dispo.ts` (visit = children × 5 min, at least 10 min; rated by driving time and delays against the booked slot). `PUT /api/intern/pflege/nikolaus-dispo?date=` saves it. For the map, `POST /api/intern/nikolaus/dispo/routes?date=` returns each team's course along the roads (OpenRouteService directions, cached; straight lines without the service). SharePoint list „Nikolaus-Dispo“, one row per planned booking:

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
- **Test data:** `cd api && bun scripts/nikolaus-testdata.ts` fills every free place of the configured slots with invented, confirmed families (real streets found via Nominatim, e-mails `@nikolaus-test.invalid`, phone numbers from the Bundesnetzagentur fiction range (089) 99998-xxx). `--dry-run` only shows them, `--delete` removes all test bookings and their Dispo rows again – run it before going live. About a quarter of the families get a group tag. `--helfende` (with `--dry-run`/`--delete`) does the same for about 30 invented helpers, marked with `[Test]` in their notes. Uses `api/local.settings.json`.
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
  - `/leitendenbereich/gruppenstunden`, `/leitendenbereich/leitende`, `/leitendenbereich/downloads`: edit modules for the SharePoint lists behind the public pages (`/api/intern/pflege/*`). Changes are visible on the website immediately. See "Edited SharePoint lists" below.
- **App registration:** the login reuses the existing registration (`AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`). It needs a *Web* platform with the redirect URI `https://<domain>/.auth/login/aad/callback` (also for preview environments) and ID tokens enabled; `AZURE_CLIENT_SECRET` must hold a valid client secret.
- **Local testing:** `just dev-full`, then open http://localhost:4280/leitendenbereich. The SWA CLI shows a mock login: use provider `aad` and role `authenticated`. If you add a `tid` claim, it must match `AZURE_TENANT_ID`.

### Edited SharePoint lists

| List / library | Columns | Notes |
| --- | --- | --- |
| Gruppenstunden (`SHAREPOINT_GRUPPENSTUNDEN_LIST_ID`) | `Title` (Stufe), `Wochentag`, `Zeit`, `Alter`, `Ort`, `Beschreibung` (rich text) | `Title` must equal a `Team` value of the Leitende list, otherwise no leaders are shown for the group |
| Leitende (`SHAREPOINT_LEITENDE_LIST_ID`) | `Title` (name), `Team` (multi-choice), `Telefon`, `Adresse` (location), `Image0` (image) | Phone and address are only shown publicly for `Vorstand`. New teams are added as choice values in SharePoint |
| Downloads (`SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID`) | files in the root folder | Deleted files go to the site's recycle bin |

- Graph cannot write location and image columns or attachments, so `Adresse`, `Image0` and the photo attachments are written through the SharePoint REST API (`api/lib/sharepoint-rest.ts`). The app registration therefore needs **SharePoint** write permission in addition to Graph.
- Saving sends the item's `etag`; if someone else changed the item in the meantime, the API answers `409 CONFLICT` instead of overwriting.
- Download uploads use a Graph upload session: the API returns a short-lived upload URL and the browser sends the file directly to SharePoint.
- SharePoint records the app as editor; every change is logged with the acting user (`[pflege] …` in the Functions logs).

## Styling

- Global theme tokens, gradients, and utility classes are defined in `web/src/styles/global.css`
- Base layout and shell: `web/src/layouts/BaseLayout.astro`; navigation/footer in `web/src/components/`

## Testing

- Build validation: `bun run build` (in `web/` and `api/`)

### Sammelbestellungen (Rüsthaus)

Leaders create campaigns at `/leitendenbereich/sammelbestellungen`, choose the order window and edit the starting selection of common Rüsthaus articles. The default selection links to shirts, neckerchiefs and knots; it contains no cached prices or stock information. Members can also enter any other article by article number or HTTPS product link, with its name, size/variant and quantity.

Copy the campaign's **shared invitation link** into the same CampFlow email for all members. The page asks for an email address and sends a personal order link through Microsoft Graph. CampFlow does not need to personalize links. Possession of the shared link grants permission to request an order link; there is no automatic check against the CampFlow membership list, so distribute it only to members. One normalized email address has one order per campaign, including a shared family order for siblings.

Campaign invitations and new orders are accessible only during the configured period. Personal links keep showing the order after the deadline, but changes are rejected. Leaders lock an individual order by setting `Bestellt`, `Eingetroffen` or `Storniert`. Both member edits and staff status changes use SharePoint ETags, so a simultaneous member edit cannot overwrite a staff lock. Setting `Eingereicht` explicitly reopens that order while the period is still open. A member edit clears a previously recorded total and payment flag because the ordered articles may have changed.

The leader overview includes submitted orders, a combined purchasing list grouped by article name/reference and variant, and CSV downloads for both. Drafts and cancelled orders are excluded from the combined list. Leaders record the final total in euros and check payment and delivery manually. Automatic CampFlow contributions and payment requests are tracked in [sub-issue #89](https://github.com/stamm-phoenix/website-astro/issues/89).

#### Setup before deployment

Create two SharePoint lists in the configured site with these **internal column names**. Create the columns with these names first; display labels can be renamed afterwards. JSON columns must be plain-text multiple-line columns, without append-only history or rich text.

| List / setting | Columns |
| --- | --- |
| Campaigns (`SHAREPOINT_SAMMELBESTELLUNGEN_LIST_ID`) | `Title` (text), `Beschreibung` (multiple lines), `Beginn`, `Ende` (text, UTC ISO timestamps), `Katalog` (multiple lines, JSON), `CreationKey` (text, **enforce unique values**) |
| Orders (`SHAREPOINT_SAMMELBESTELLUNGEN_ORDERS_LIST_ID`) | `Title` (text, **not required**, initially blank), `Email` (text), `AktionId` (text, **indexed**), `OrderKey` (text, **enforce unique values**), `Artikel`, `Bemerkungen` (multiple lines), `Status` (choice: `Eingereicht`, `Bestellt`, `Eingetroffen`, `Storniert`), `Eingereicht`, `Bezahlt`, `Ausgeliefert` (Yes/No), `BetragCent` (number, optional), `LinkGesendetAm` (text, UTC ISO timestamp) |

`OrderKey` is a campaign ID plus a hash of the normalized email. Its database uniqueness constraint prevents duplicate orders even when two requests race. `CreationKey` likewise prevents retrying the same create form from creating another campaign. Both constraints are required, not just indexes. Set the list IDs in the Functions application settings and `api/local.settings.json`; see `api/local.settings.example.json`.

Also configure:

- `SAMMELBESTELLUNG_LINK_SECRET`: a random secret of at least 32 characters, e.g. generated with `openssl rand -hex 32`. Use a distinct secret per environment and keep it stable across redeployments. HMAC tokens are domain-separated between campaign invitations and personal order links. Rotating this secret invalidates all previous links.
- `SAMMELBESTELLUNG_MAIL_SENDER`: the sender mailbox, e.g. `kontakt@stamm-phoenix.de`. Microsoft Graph application permission `Mail.Send` and access to that mailbox are required. Nikolaus continues to use its existing sender setting.
- `SITE_URL`: the shared canonical HTTPS site URL, or `http://localhost:4280` behind the SWA CLI locally. Set it in the Functions application settings as well as the frontend build environment. Nikolaus still uses `NIKOLAUS_SITE_URL`; migrating it to the shared setting is a separate step.

Links carry tokens in URL fragments, never query parameters. The browser sends them only in JSON request bodies and keeps the current link in session storage for tab-local reloads and skip-link navigation. Member pages are excluded from the sitemap and have `noindex`, `no-store` and `no-referrer` route headers. All new API responses, including errors, use `no-store`. Link requests use a honeypot and a 15-minute per-order cooldown reserved with an ETag. Mail failures clear that reservation without invalidating existing links. These limits do not replace an edge rate limit if a shared invitation is distributed publicly.

Order rows allow at most 40 articles with quantities from 1 to 99; the common selection allows at most 30 articles. Times entered by leaders and displayed deadlines use Europe/Berlin, independent of the browser timezone, and are stored in UTC. Nonexistent times during the daylight-saving change are rejected. Campaign definitions are fixed after creation in this first implementation; corrections can be made in SharePoint. Remove old orders from the production lists under the tribe's retention policy. Personal links stop resolving when their order or campaign is deleted.

API tests use simulated SharePoint and mail responses. For local browser testing use the SWA CLI with an `aad`/`authenticated` mock staff login. Never send test emails to real members or create real CampFlow contributions. If testing against the real SharePoint lists, follow the repository rule to name test data `TEST – bitte löschen` and delete it immediately afterwards.
