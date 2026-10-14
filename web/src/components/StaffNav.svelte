<script lang="ts">
  import { authStore, fetchPrincipal } from '../lib/authStore.svelte';
  import { fetchNikolausStatus, nikolausStatusStore } from '../lib/nikolausStatusStore.svelte';
  import type { StaffModule } from '../lib/staffModules';

  interface NavSection {
    id: string;
    title: string;
    modules: StaffModule[];
  }

  interface Props {
    sections: NavSection[];
    /** Shown in the section „Nikolausdienst“ while the staff modules are switched on. */
    nikolausModules: StaffModule[];
    nikolausControl: StaffModule;
    /** The current page. */
    current: string;
    /** The pages above the current page; their module counts as current too. */
    ancestors: string[];
  }

  let { sections, nikolausModules, nikolausControl, current, ancestors }: Props = $props();

  let open = $state(false);
  let button = $state<HTMLButtonElement>();
  let panel = $state<HTMLDivElement>();

  const allSections = $derived([
    ...sections,
    {
      id: 'nikolaus',
      title: 'Nikolausdienst',
      modules: [...(nikolausStatusStore.data?.staffActive ? nikolausModules : []), nikolausControl],
    },
  ]);

  function currentState(href: string): 'page' | 'true' | undefined {
    if (href === current) return 'page';
    return ancestors.includes(href) ? 'true' : undefined;
  }

  function toggle(): void {
    open = !open;
    // Only asked for when the menu is used, so a page load costs no extra request
    if (open) {
      void fetchNikolausStatus();
      void fetchPrincipal();
    }
  }

  function close(): void {
    open = false;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') {
      close();
      button?.focus();
    }
  }

  function onclick(event: MouseEvent): void {
    const target = event.target as Node;
    if (open && !button?.contains(target) && !panel?.contains(target)) close();
  }
</script>

<svelte:document {onkeydown} {onclick} />

<button
  bind:this={button}
  type="button"
  aria-expanded={open}
  aria-controls="staff-nav"
  class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm font-semibold text-brand-900 hover:bg-neutral-100 sm:px-3"
  onclick={toggle}
>
  <svg
    aria-hidden="true"
    class="size-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
  Menü
</button>

<!-- The account links stay below the scrolling list, so they are visible however long it gets -->
<div
  bind:this={panel}
  id="staff-nav"
  class="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-5rem)] flex-col border border-neutral-300 bg-surface shadow-soft sm:top-[calc(100%+0.5rem)] sm:right-4 sm:left-auto sm:w-[min(56rem,calc(100vw-2rem))] {open
    ? 'flex'
    : 'hidden'}"
>
  <nav
    aria-label="Bereiche des Leitendenbereichs"
    class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4"
  >
    <div class="gap-x-8 sm:columns-2 lg:columns-3">
      {#each allSections as section (section.id)}
        <section aria-labelledby="staff-nav-{section.id}" class="mb-4 break-inside-avoid">
          <h2 id="staff-nav-{section.id}" class="text-base font-semibold text-brand-900">
            {section.title}
          </h2>
          <ul class="mt-1">
            {#each section.modules as module (module.href)}
              <li>
                <a
                  href={module.href}
                  data-astro-reload={module.reload || undefined}
                  aria-current={currentState(module.href)}
                  class="flex min-h-11 items-center gap-3 py-1 text-sm text-brand-900 no-underline hover:underline pointer-fine:min-h-9 aria-[current]:font-semibold aria-[current]:underline aria-[current]:decoration-[var(--color-accent-500)] aria-[current]:decoration-2 aria-[current]:underline-offset-4"
                  onclick={close}
                >
                  <svg
                    aria-hidden="true"
                    class="size-4 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d={module.icon} />
                  </svg>
                  {module.title}
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  </nav>
  <div class="border-t border-neutral-300 px-4 py-2 text-sm">
    {#if authStore.principal}
      <p class="pt-1 text-neutral-700">
        Angemeldet als <span class="font-semibold">{authStore.principal.userDetails}</span>
      </p>
    {/if}
    <ul class="flex flex-wrap gap-x-6">
      <li>
        <a href="/leitendenbereich" class="inline-flex min-h-11 items-center text-link">
          Übersicht
        </a>
      </li>
      <li>
        <a href="/" class="inline-flex min-h-11 items-center text-link">Zur Website</a>
      </li>
      <li>
        <a href="/logout" class="inline-flex min-h-11 items-center font-semibold text-link">
          Abmelden
        </a>
      </li>
    </ul>
  </div>
</div>
