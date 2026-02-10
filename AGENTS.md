# AGENTS.md - Stamm Phoenix Website

Guidelines for AI agents working on this Astro 5 + Tailwind CSS 4 website for DPSG Stamm Phoenix.

## Commands

```bash
# Setup
pnpm install                    # Install dependencies (~40s, never cancel)

# Development
pnpm dev                        # Dev server at localhost:4321
pnpm build                      # Production build (~6s)
npx astro check                 # TypeScript validation (ignore /api errors)

# E2E Tests (requires dev server running in separate terminal)
npx cypress run                                       # Run all tests
npx cypress run --spec "tests/e2e/navigation.cy.ts"  # Single test file
npx cypress open                                      # Interactive mode
```

## Project Structure

```
src/
├── components/       # .astro (static) and .svelte (interactive) components
├── layouts/          # BaseLayout.astro wraps all pages
├── pages/            # File-based routing (kebab-case filenames)
├── styles/           # global.css with Tailwind v4 @theme tokens
├── lib/              # Utilities, types, Svelte stores (*Store.svelte.ts)
tests/e2e/            # Cypress tests (*.cy.ts)
public/               # Static assets served at root
api/                  # Netlify serverless functions
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
  import { untrack } from "svelte";
  import { someStore, fetchData } from "../lib/someStore.svelte";
  import type { SomeType } from "../lib/types";

  interface Props {
    items: string[];
  }
  let { items }: Props = $props();
  let selected = $state<string | null>(null);
  const filtered = $derived(items.filter(i => i !== selected));

  $effect(() => {
    untrack(() => fetchData());
  });
</script>

<ul class="flex gap-2">
  {#each items as item (item)}
    <li><button onclick={() => selected = item}>{item}</button></li>
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
- Define shared types in `src/lib/types.ts`
- Custom errors extend `Error` class (see `ApiError` in api.ts)

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `HeroSection.astro`, `EventFilter.svelte` |
| Pages | kebab-case | `gruppenstunden.astro` |
| Utilities | camelCase | `formatDate.ts`, `dateUtils.ts` |
| Stores | camelCase + Store | `aktionenStore.svelte.ts` |
| Tests | kebab-case | `navigation.cy.ts` |
| Types/Interfaces | PascalCase | `interface Aktion` |
| Constants | UPPER_SNAKE | `GROUP_CONFIG`, `STUFE_ORDER` |

### Tailwind CSS

Design tokens defined in `src/styles/global.css` via `@theme`:

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
.surface         /* Card with backdrop blur and border */
.surface-muted   /* Muted gradient card */
.card            /* Basic card with shadow */
.badge           /* Small uppercase label */
.grid-overlay    /* Decorative grid pattern */
```

### Accessibility

- Link sections to headings: `<section aria-labelledby="id"><h2 id="id">`
- Decorative images: `<img alt="" aria-hidden="true">`
- Loading states: `<div role="status" aria-live="polite">`
- Interactive elements need `aria-expanded`, `aria-pressed` where applicable
- Skip link exists in BaseLayout for keyboard navigation

## E2E Tests (Cypress)

```typescript
/// <reference types="cypress" />

describe('Feature', () => {
  beforeEach(() => {
    cy.viewport(1280, 720);  // or 375, 667 for mobile
    cy.visit('/page');
  });

  it('describes expected behavior', () => {
    cy.get('h1').should('contain', 'Title');
    cy.get('[aria-label="Navigation"]').contains('Link').click();
    cy.url().should('include', '/path');
  });
});
```

## Svelte Stores Pattern

Stores in `src/lib/*Store.svelte.ts` follow this pattern:

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

## Known Limitations

- `/aktionen` page fails locally (external ICS calendar dependency)
- `/admin` CMS has limited functionality locally
- `pnpm preview` does not work (Netlify adapter)
- `npx astro check` shows errors for `/api` directory (expected)

## Before Committing

1. `pnpm build` completes without errors
2. `npx astro check` passes (ignore /api errors)
3. Test affected pages manually in dev server
4. Verify responsive design (mobile + desktop)
5. Check accessibility (semantic HTML, ARIA attributes)
