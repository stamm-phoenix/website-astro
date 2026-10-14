<script lang="ts">
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
    if (open) void fetchNikolausStatus();
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
  class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm font-semibold text-brand-900 hover:bg-neutral-100"
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
  <span class="sr-only sm:not-sr-only">Bereiche</span>
</button>

<div
  bind:this={panel}
  id="staff-nav"
  class="absolute right-3 top-[calc(100%+0.5rem)] z-50 max-h-[calc(100dvh-7rem)] w-[min(44rem,calc(100%-1.5rem))] overflow-y-auto overscroll-contain rounded-sm border border-neutral-300 bg-surface p-4 shadow-soft md:right-5"
  class:hidden={!open}
>
  <nav aria-label="Bereiche des Leitendenbereichs">
    <div class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {#each allSections as section (section.id)}
        <section aria-labelledby="staff-nav-{section.id}">
          <h2 id="staff-nav-{section.id}" class="text-xs font-semibold uppercase text-neutral-700">
            {section.title}
          </h2>
          <ul class="mt-1">
            {#each section.modules as module (module.href)}
              <li>
                <a
                  href={module.href}
                  data-astro-reload={module.reload || undefined}
                  aria-current={currentState(module.href)}
                  class="flex min-h-11 items-center gap-3 py-1 text-sm text-brand-900 no-underline hover:underline aria-[current]:font-semibold aria-[current]:underline aria-[current]:decoration-[var(--color-accent-500)] aria-[current]:decoration-2 aria-[current]:underline-offset-4"
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
    <ul class="mt-4 flex flex-wrap gap-x-6 border-t border-neutral-200 pt-2 text-sm">
      <li>
        <a href="/leitendenbereich" class="inline-flex min-h-11 items-center text-link">
          Übersicht
        </a>
      </li>
      <li>
        <a href="/" class="inline-flex min-h-11 items-center text-link">Zur Website</a>
      </li>
      <li>
        <a href="/logout" class="inline-flex min-h-11 items-center text-link">Abmelden</a>
      </li>
    </ul>
  </nav>
</div>
