# AGENTS.md - Stamm Phoenix Website

Guidelines for AI agents working on this Astro 7 + Svelte 5 + Tailwind CSS 4 website for DPSG Stamm Phoenix.

## Commands

Frontend commands run in `web/`, API commands in `api/`.

```bash
# Frontend (cd web)
bun install                     # Install dependencies (~5s)
bun run dev                     # Dev server at localhost:4321
bun run build                   # Production build (~5s)
bunx astro check                # TypeScript validation
bun run lint                    # ESLint

# API (cd api)
bun install                     # Install dependencies
bun run build                   # Compile with tsc
bun run lint                    # ESLint
TEST_SQL_PASSWORD=… bun run test  # Tests; database tests need a SQL Server (docs/azure-sql.md)
```

## Project Structure

```
web/                  # Astro frontend
├── src/
│   ├── components/   # .astro (static) and .svelte (interactive) components
│   ├── layouts/      # BaseLayout.astro wraps all pages
│   ├── pages/        # File-based routing (kebab-case filenames)
│   ├── styles/       # global.css with Tailwind v4 @theme tokens
│   └── lib/          # Utilities, types, Svelte stores (*Store.svelte.ts)
└── public/           # Static assets served at root (incl. staticwebapp.config.json)
api/                  # Azure Functions backend (deployed via SWA api_location)
└── migrations/       # SQL migrations of the Azure SQL database (Nikolaus, Blog, FAQ, Anwesenheit)
```

## Code Style

### Astro Components (.astro)

```astro
---
// 1. Imports (components, then utilities)
import Button from '../components/Button.astro';
import { formatDate } from '../lib/dateUtils';

// 2. Props interface (always use `interface`, not `type`)
interface Props {
  title: string;
  description?: string;
}

// 3. Destructure with defaults
const { title, description } = Astro.props;
---

<!-- 4. Template with semantic HTML -->
<section aria-labelledby="section-id">
  <h2 id="section-id" class="font-serif text-2xl text-brand-900">{title}</h2>
  {description && <p class="text-neutral-700">{description}</p>}
  <slot />
</section>

<style>
  /* Scoped styles only when Tailwind is insufficient */
</style>
```

### Svelte Components (.svelte)

```svelte
<script lang="ts">
  // Svelte 5 runes syntax
  import { untrack } from 'svelte';
  import { someStore, fetchData } from '../lib/someStore.svelte';
  import type { SomeType } from '../lib/types';

  interface Props {
    items: string[];
  }
  let { items }: Props = $props();
  let selected = $state<string | null>(null);
  const filtered = $derived(items.filter((i) => i !== selected));

  $effect(() => {
    untrack(() => fetchData());
  });
</script>

<ul class="flex gap-2">
  {#each items as item (item)}
    <li><button onclick={() => (selected = item)}>{item}</button></li>
  {/each}
</ul>

<style>
  /* Component-scoped styles, use CSS variables from global.css */
</style>
```

### TypeScript

- Use `interface` for object shapes (not `type`)
- Explicit return types for exported functions
- No `any` - use `unknown` with type guards
- Define shared types in `web/src/lib/types.ts`
- Custom errors extend `Error` class (see `ApiError` in api.ts)

### Naming Conventions

| Type             | Convention        | Example                                   |
| ---------------- | ----------------- | ----------------------------------------- |
| Components       | PascalCase        | `HeroSection.astro`, `EventFilter.svelte` |
| Pages            | kebab-case        | `gruppenstunden.astro`                    |
| Utilities        | camelCase         | `formatDate.ts`, `dateUtils.ts`           |
| Stores           | camelCase + Store | `aktionenStore.svelte.ts`                 |
| Tests            | kebab-case        | `navigation.cy.ts`                        |
| Types/Interfaces | PascalCase        | `interface Aktion`                        |
| Constants        | UPPER_SNAKE       | `GROUP_CONFIG`, `STUFE_ORDER`             |

### Tailwind CSS

Design tokens defined in `web/src/styles/global.css` via `@theme`:

```css
/* Colors */
text-brand-900              /* Primary text (DPSG blue) */
text-neutral-700            /* Secondary text */
bg-[var(--color-dpsg-red)]  /* DPSG red #810a1a */
bg-[var(--color-dpsg-blue)] /* DPSG blue #003056 */

/* Scout group colors */
bg-[var(--color-dpsg-woelflinge)]    /* Orange */
bg-[var(--color-dpsg-jupfis)]        /* Blue */
bg-[var(--color-dpsg-pfadfinder)]    /* Green */
bg-[var(--color-dpsg-rover)]         /* Red */

/* Utility classes (defined in global.css) */
.surface         /* Theme-aware panel with a border */
.surface-muted   /* Theme-aware muted panel */
.card            /* Theme-aware card without lift effects */
.badge           /* Plain status text */
.grid-overlay    /* Legacy class, hidden */
```

### Leitfaden UI

Use the shared UI components and semantic colors documented in `docs/ui/leitfaden.md`. Svelte action buttons use `components/ui/ActionButton.svelte`, filter/view selectors use `FilterTabs.svelte`, and status labels use `StatusLabel.svelte`. Keep explicit button types and existing ARIA/tab keyboard behavior. Surfaces, field borders and status text must support the automatic dark theme; preserve fixed DPSG colors only for brands and group markers.

### Accessibility

- Link sections to headings: `<section aria-labelledby="id"><h2 id="id">`
- Decorative images: `<img alt="" aria-hidden="true" width="X" height="Y">`
- Loading states: `<div role="status" aria-live="polite">`
- Interactive elements need `aria-expanded`, `aria-pressed` where applicable
- Skip link exists in BaseLayout for keyboard navigation
- Always include `width` and `height` attributes on images to prevent CLS

## Svelte Stores Pattern

Stores in `web/src/lib/*Store.svelte.ts` follow this pattern:

```typescript
import { fetchApi } from "./api";
import type { DataType } from "./types";

interface StoreState {
  data: DataType[] | null;
  loading: boolean;
  error: boolean;
}

export const dataStore = $state<StoreState>({
  data: null,
  loading: false,
  error: false,
});

export async function fetchData(): Promise<void> {
  if (dataStore.data !== null) return;
  dataStore.loading = true;
  dataStore.error = false;
  try {
    dataStore.data = await fetchApi<DataType[]>("/endpoint");
  } catch {
    dataStore.error = true;
  } finally {
    dataStore.loading = false;
  }
}
```

## Shared Config

`api/lib/nikolaus-config.ts` (helpers for the Nikolaus settings, without values) and `api/lib/campflow-groups.ts` (CampFlow group → Stufe) are imported by both the API and the frontend (via `web/src/lib/nikolausConfig.ts` and `web/src/lib/campflowGroups.ts`). It lives in `api/` because only that folder is deployed as the SWA API. Keep them free of imports and Node/browser-specific APIs.

## API Configuration

Non-secret values (tenant and client ID, database server and name, SharePoint site, list and drive IDs, mail senders, limits, geocoding URL) live in `CONFIG` in `api/lib/config.ts`. Only secrets and operational switches are read from the environment via `EnvironmentVariable` (`api/lib/environment.ts`); never add an environment override for a `CONFIG` value. New lists go into `CONFIG.sharepoint.lists`, not into App Settings. In tests, change values with `overrideConfig` (`api/test/fixtures/config.ts`).

Operational switches stay environment variables so they can be flipped without a deployment; a missing or non-`"true"` value is the safe state. The Nikolausdienst has none: its days, times, switches (online booking, staff modules, maintenance mode) and the deletion after the season are controlled in the Leitendenbereich (module „Steuerung“, `api/lib/nikolaus-settings.ts`, `docs/nikolaus-betrieb.md`). Never add Nikolaus settings to `CONFIG` or the environment; read them with `getNikolausSettings()` and pass them on.

The App Settings `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` are read by the SWA login (`staticwebapp.config.json`) and must stay in Azure.

## Database

The Nikolaus data (bookings, helpers, Einteilung, Dispo, shared state, settings and their log), the blog, the FAQ and the Anwesenheit of the Gruppenstunden live in Azure SQL (schemas `nikolaus`, `content` and `gruppenstunde`), files such as blog images in Azure Blob Storage (`api/lib/blob-storage.ts`, `CONFIG.storage`); the rest is still in SharePoint (#165). Setup, restore and tests: `docs/azure-sql.md`.

- The schema belongs to the repo: a change is a new file `api/migrations/NNNN_name.sql` (never edit an applied one) plus the types in `api/lib/db-schema.ts`. Migrations run in the deploy job on `main` before the code ships, so changes must be backwards compatible (add first, remove in a later PR). Never change tables by hand.
- Each PR preview has its own database `website-pr-<number>` on the separate preview server (`CONFIG.database.previewServer`, never the production server) and blob container `pr-<number>` (in the separate preview storage account) with test data, created, migrated and seeded by `api/scripts/db-preview.ts` in the deploy job and dropped when the PR closes; the workflow writes their names into `api/lib/deployment.ts`, which must stay `null` in the repo.
- Every table in Azure SQL has test data in the previews. A PR that adds tables (e.g. moving a SharePoint list to Azure SQL) also extends the seeding in `api/scripts/db-preview.ts` (invented data only, never copied from production; every step fills only what is missing) and raises the number in `SEEDED_KEY` (`api/lib/db-preview.ts`), so existing previews are filled up.
- Data access goes through `api/lib/db.ts` (Kysely). Conditional writes compare the `rowversion` (`etag` in DTOs, `VersionConflictError` → 412); rules across rows (capacity, one plan) run in `inTransaction` with `lockResource`, never as write-then-verify.
- API tests that need the database use `dbTest` from `api/test/fixtures/database.ts`; each file gets its own database with all migrations. Locally they are skipped without `TEST_SQL_PASSWORD`, in CI they are required.

## Leitendenbereich

Pages under `web/src/pages/leitendenbereich/` and API routes under `/api/intern/*` are only for logged-in members of our Entra ID tenant (see `web/public/staticwebapp.config.json`). Every new `intern/*` endpoint must start with `requireStaff(request)` from `api/lib/staff-auth.ts`; `intern/nikolaus/*` endpoints start with `requireNikolausStaff(request)` (`api/lib/nikolaus-staff.ts`), which also refuses them while the staff modules are switched off (`pflegeHandler` does this for areas `nikolaus-*`, and stops their writes in maintenance mode; only the area `nikolaus-steuerung` is exempt). New modules are registered in `STAFF_MODULES` (`web/src/lib/staffModules.ts`); modules of the Nikolausdienst go into `NIKOLAUS_MODULES`, shown by `NikolausStaffSection.svelte` in the section „Nikolausdienst“ while they are switched on.

Write endpoints for the edit modules (SharePoint lists and the `content` tables) live under `/api/intern/pflege/*` and are wrapped in `pflegeHandler` (`api/lib/pflege-api.ts`), which checks the login, maps SharePoint errors (412 → `409 CONFLICT`) and logs the acting user. Validate input in `api/lib/pflege-validation.ts`; forms in `web/src/components/pflege/` use `FormField`, `EditDialog` and `sendApi`. When testing against the real lists or the database, name test data "TEST – bitte löschen" and delete it again right away — they hold production data.

## Baked Content

Public content (Gruppenstunden, Vorstand, Aktionen, Blog incl. `/blog/<id>/` pages, Downloads, Q&A, Instagram) is baked into the HTML at build time and refreshed in the browser. Nikolaus data always stays live. Details and setup: `docs/eingebackene-inhalte.md`.

- Pages load it in their frontmatter from `web/src/lib/content/content.ts` (build-time only, never import it in islands) and pass `initial` (and `images`) to the island; islands render `withBaked(store, initial)` from `web/src/lib/storeView.ts`, so loading/error states only appear when nothing was baked.
- Image URLs go through `bakedUrl` (`web/src/lib/bakedImages.ts`); sanitizers must use `parseHtml` (`web/src/lib/html.ts`), not the global `document`, because islands are rendered during the build.
- `CONTENT_SOURCE` is `mock` by default (test data from `web/dev/mockApi.ts`), `live` on `main`; `CONTENT_STRICT=1` fails the build when a source is missing (or a comma-separated list of source names; the content refresh passes the sources the deployed site has).
- Aktionen: CampFlow is the main source. Calendar entries linked via `CampFlowId` get title, dates and link live from CampFlow in `getAktionen()` (`api/lib/aktionen-list.ts`); only Stufen and description are edited on the website.
- New public endpoints go into `CONTENT_SOURCES` (`web/src/lib/content/version.ts`); new Pflege areas with public content into `PUBLIC_CONTENT_AREAS` (`api/lib/site-rebuild.ts`), which triggers the content refresh (jobs `content-*` in the main workflow `.github/workflows/azure-static-web-apps-zealous-water-04f606303.yml`; it must stay in that file, because the Static Web App accepts OIDC deploys only from the workflow file named after it).

## Privacy

The site needs no cookie banner and must stay that way. Do not add analytics, tracking, ad or social widgets, or captchas from third parties (use self-hosted alternatives). The one deliberate exception is Cloudflare in front of the Static Web App: it injects its bot detection (`/cdn-cgi/…/jsd/main.js`, may set the strictly necessary `__cf_bm` cookie) and cookieless Web Analytics (`static.cloudflareinsights.com`). Both are configured in the Cloudflare dashboard, not in this repo, are described on `/datenschutz` and allowed in the CSP (`web/public/staticwebapp.config.json`); their Lighthouse warnings (deprecated APIs, legacy JS) are accepted. Fonts and images are served from our own origin. A third-party embed or script loads only after an explicit click, like the Campflow form (`MembershipApplication.astro`) and Instagram videos (`InstagramConsentDialog.svelte`). Browser storage is only for functions the visitor uses. Every new third-party connection, storage key or form must be described on `/datenschutz` (`web/src/pages/datenschutz.astro`).

## Known Limitations

- `/aktionen` page fails locally (external ICS calendar dependency)
- `/admin` CMS has limited functionality locally
- `bun run preview` does not work (Azure Static Web Apps adapter)

## Before Committing

1. `bun run build` completes without errors (in `web/`, and in `api/` if the API changed)
2. `bunx astro check` passes (in `web/`)
3. Test affected pages manually in dev server
4. Verify responsive design (mobile + desktop)
5. Check accessibility (semantic HTML, ARIA attributes)
