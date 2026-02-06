# AGENTS.md - Stamm Phoenix Website

Guidelines for AI agents working on this Astro 5 + Tailwind CSS 4 website for DPSG Stamm Phoenix.

## Quick Reference

```bash
pnpm install          # Install deps (~40s)
pnpm dev              # Dev server at localhost:4321
pnpm build            # Production build (~6s)
npx astro check       # TypeScript validation

# E2E tests (dev server must be running)
npx cypress run                                      # All tests
npx cypress run --spec "tests/e2e/navigation.cy.ts" # Single test
npx cypress open                                     # Interactive
```

## Project Structure

```
src/
├── components/       # UI components (.astro, .svelte)
├── layouts/          # Page layouts (BaseLayout.astro)
├── pages/            # File-based routing
├── styles/           # Global CSS with Tailwind v4 theme
├── data/             # JSON data files
├── lib/              # Utility functions
tests/e2e/            # Cypress E2E tests
public/               # Static assets
```

## Code Style

### Astro Components (.astro)

```astro
---
// 1. Imports
import Button from '../components/Button.astro';

// 2. Props interface
interface Props {
  title: string;
  description?: string;
}

// 3. Destructure with defaults
const { title, description } = Astro.props;
---

<!-- 4. Template -->
<section aria-labelledby="section-title">
  <h2 id="section-title" class="font-serif text-2xl text-brand-900">{title}</h2>
  {description && <p class="text-neutral-700">{description}</p>}
  <slot />
</section>

<style>
  /* Scoped styles only when Tailwind insufficient */
</style>
```

### Svelte Components (.svelte)

```svelte
<script lang="ts">
  // Svelte 5 runes syntax
  interface Props {
    items: string[];
  }
  let { items }: Props = $props();
  let selected = $state<string | null>(null);
</script>

<ul class="flex gap-2">
  {#each items as item}
    <li><button onclick={() => selected = item}>{item}</button></li>
  {/each}
</ul>
```

### TypeScript

- Use `interface` for props (not `type`)
- Explicit types for function parameters
- No `any` - use `unknown` if needed
- Optional chaining: `obj?.prop`

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `HeroSection.astro` |
| Pages | kebab-case | `gruppenstunden.astro` |
| Utilities | camelCase | `formatDate.ts` |
| Test files | kebab-case | `navigation.cy.ts` |

### Tailwind CSS

Design tokens in `src/styles/global.css`:

```css
text-brand-900              /* Primary text */
text-neutral-700            /* Secondary text */
bg-[var(--color-dpsg-red)]  /* DPSG red #810a1a */
bg-[var(--color-dpsg-blue)] /* DPSG blue #003056 */

/* Utility classes */
.surface       /* Card with backdrop blur */
.surface-muted /* Muted gradient card */
.badge         /* Small label */
.card          /* Basic card */
.grid-overlay  /* Decorative grid */
```

### Accessibility

```astro
<!-- Link sections to headings -->
<section aria-labelledby="unique-id">
  <h2 id="unique-id">Title</h2>
</section>

<!-- Decorative images -->
<img src="/pattern.png" alt="" aria-hidden="true" />
```

## E2E Tests (Cypress)

```typescript
/// <reference types="cypress" />
describe('Page', () => {
  beforeEach(() => cy.visit('/page'));

  it('shows content', () => {
    cy.get('h1').should('contain', 'Title');
    cy.contains('Link').click();
    cy.url().should('include', '/path');
  });
});
```

## Known Limitations

- `/aktionen` fails locally (external ICS dependency)
- `/admin` CMS limited locally
- `pnpm preview` does not work

## Before Committing

1. `pnpm build` completes without errors
2. `npx astro check` passes (ignore `/api` errors)
3. Test affected pages in dev server
4. Check responsive design & accessibility
