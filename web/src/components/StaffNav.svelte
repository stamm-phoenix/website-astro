<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import StaffModuleSearch from './StaffModuleSearch.svelte';
  import { authStore, fetchPrincipal } from '../lib/authStore.svelte';
  import { fetchNikolausStatus, nikolausStatusStore } from '../lib/nikolausStatusStore.svelte';
  import { favoritesStore, loadFavorites } from '../lib/staffFavoritesStore.svelte';
  import { loadRecent, recentStore, recordVisit } from '../lib/staffRecentStore.svelte';
  import {
    STAFF_DEFAULT_QUICK,
    STAFF_FAVORITE_PATHS,
    STAFF_HOME,
    type StaffModule,
  } from '../lib/staffModules';
  import { yourStaffModules, type StaffModuleGroup } from '../lib/staffSearch';
  import { HELP_CONTACTS } from '../lib/helpContacts';

  interface Props {
    sections: StaffModuleGroup[];
    /** Shown in the section „Nikolausdienst“ while the staff modules are switched on. */
    nikolausModules: StaffModule[];
    nikolausControl: StaffModule;
    /** The current page. */
    current: string;
    /** The pages above the current page; their module counts as current too. */
    ancestors: string[];
    /** The module of the current page, recorded as recently used; none on the start page. */
    module?: string;
  }

  let { sections, nikolausModules, nikolausControl, current, ancestors, module }: Props = $props();

  /** Areas in the bar between „Übersicht“ and „Menü“. */
  const QUICK_COUNT = 3;
  const nikolausActive = $derived(nikolausStatusStore.data?.staffActive === true);
  // Modules of the Nikolausdienst only while they are switched on (Steuerung always)
  const allModules = $derived([
    ...sections.flatMap((section) => section.modules),
    nikolausControl,
    ...(nikolausActive ? nikolausModules : []),
  ]);
  const groups = $derived<StaffModuleGroup[]>([
    ...sections,
    {
      id: 'nikolaus',
      title: 'Nikolausdienst',
      modules: [...(nikolausActive ? nikolausModules : []), nikolausControl],
    },
  ]);

  // Favorites first, then the recently used areas, filled up with the usual ones
  // Without favorites (load failed, login not checked) the bar still fills up
  const ready = $derived(
    recentStore.loaded &&
      (nikolausStatusStore.data !== null || nikolausStatusStore.error !== null) &&
      (favoritesStore.loaded ||
        favoritesStore.loadError !== null ||
        (!authStore.loading && !authStore.principal))
  );
  const quick = $derived.by(() => {
    const picked = yourStaffModules(
      favoritesStore.loaded ? favoritesStore.modules : [],
      recentStore.modules,
      allModules,
      QUICK_COUNT
    );
    return yourStaffModules(
      picked.map((entry) => entry.href),
      STAFF_DEFAULT_QUICK,
      allModules,
      QUICK_COUNT
    );
  });

  // Once shown, the bar keeps its areas while the start page loads the favorites again;
  // a module that was switched off meanwhile still leaves it
  let shownQuick = $state<StaffModule[] | null>(null);
  $effect(() => {
    if (ready) {
      shownQuick = quick;
      return;
    }
    const shown = untrack(() => shownQuick);
    const kept = shown?.filter((entry) => allModules.some((module) => module.href === entry.href));
    if (shown && kept && kept.length !== shown.length) shownQuick = kept;
  });

  let open = $state(false);

  function isCurrent(href: string): boolean {
    return href === current || ancestors.includes(href);
  }
  const home = $derived(current === STAFF_HOME.href);
  // The current page is highlighted in the bar; „Menü“ stands in for modules not in it
  const inBar = $derived(home || (shownQuick ?? []).some((entry) => isCurrent(entry.href)));

  // The real height of the bar, also when a label takes two lines or the font is larger
  let bar = $state<HTMLElement>();
  $effect(() => {
    if (!bar) return;
    const element = bar;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--staff-bar-measured', `${element.offsetHeight}px`);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--staff-bar-measured');
    };
  });

  onMount(() => {
    if (module) void recordVisit(module);
    else void loadRecent();
    void fetchPrincipal();
    // Whether Nikolaus modules may appear in the bar; the Steuerung refreshes it on a change
    void fetchNikolausStatus();
  });

  // The start page loads the favorites itself (StaffDashboard); elsewhere the bar needs them
  $effect(() => {
    const userId = authStore.principal?.userId;
    // A failed load is not repeated here, the start page offers „Erneut versuchen“
    if (
      !home &&
      userId &&
      !favoritesStore.loaded &&
      !favoritesStore.loading &&
      favoritesStore.loadError === null
    ) {
      void loadFavorites(userId, STAFF_FAVORITE_PATHS);
    }
  });

  let menuButton = $state<HTMLButtonElement>();
  let closeButton = $state<HTMLButtonElement>();
  let panel = $state<HTMLElement>();

  /** Keyboard focus leaving the panel and the bar for the covered page closes the panel. */
  function onfocusin(event: FocusEvent): void {
    const target = event.target;
    if (!open || !(target instanceof Node)) return;
    if (panel?.contains(target) || bar?.contains(target)) return;
    open = false;
  }

  async function toggleSheet(): Promise<void> {
    open = !open;
    if (open) {
      await tick();
      closeButton?.focus();
    }
  }

  function closeSheet(): void {
    open = false;
    menuButton?.focus();
  }

  function onkeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape' && !event.defaultPrevented) closeSheet();
  }
</script>

{#snippet moduleTitle(module: StaffModule)}
  {#each (module.wrap ?? module.title).split('|') as part, index (index)}{#if index > 0}<wbr
      />{/if}{part}{/each}
{/snippet}

{#snippet icon(path: string)}
  <svg
    aria-hidden="true"
    class="size-6 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"><path d={path} /></svg
  >
{/snippet}

<nav
  bind:this={bar}
  aria-label="Schnellzugriff"
  data-sticky-bottom
  class="staff-bottom-bar fixed inset-x-0 bottom-0 z-40 border-t border-neutral-300 bg-surface pb-[env(safe-area-inset-bottom)] print:hidden xl:hidden"
>
  <!-- Centered on tablets, so the areas stay close together -->
  <div class="mx-auto grid max-w-xl grid-cols-5" class:sheet-open={open}>
    <a href={STAFF_HOME.href} aria-current={home ? 'page' : undefined} class="staff-bar-item">
      {@render icon('M3 11l9-8 9 8M5 10v10h14V10')}
      <span>Übersicht</span>
    </a>
    {#if shownQuick}
      {#each shownQuick as entry (entry.href)}
        <a
          href={entry.href}
          data-astro-reload={entry.reload || undefined}
          aria-current={entry.href === current
            ? 'page'
            : isCurrent(entry.href)
              ? 'true'
              : undefined}
          class="staff-bar-item"
        >
          {@render icon(entry.icon)}
          <span>{@render moduleTitle(entry)}</span>
        </a>
      {/each}
    {:else}
      {#each { length: QUICK_COUNT }, index (index)}
        <span class="staff-bar-item" aria-hidden="true"></span>
      {/each}
    {/if}
    <button
      type="button"
      class="staff-bar-item"
      bind:this={menuButton}
      aria-expanded={open}
      aria-controls="staff-nav-panel"
      aria-current={inBar || open ? undefined : 'true'}
      onclick={toggleSheet}
    >
      {@render icon('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z')}
      <span>Menü</span>
    </button>
  </div>
</nav>

{#if open}
  <!-- Dims the page above the bar; the bar stays usable, „Menü“ closes the panel again -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="staff-sheet-scrim fixed inset-x-0 top-0 z-30 print:hidden xl:hidden"
    onclick={closeSheet}
  ></div>
  <div
    bind:this={panel}
    id="staff-nav-panel"
    role="dialog"
    aria-labelledby="staff-nav-title"
    class="staff-sheet fixed inset-x-0 z-40 mx-auto flex w-full max-w-xl flex-col rounded-t-2xl border border-b-0 border-neutral-300 bg-surface shadow-lift print:hidden xl:hidden"
  >
    <div
      class="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-200 px-5 py-3"
    >
      <h2 id="staff-nav-title" class="font-serif text-xl font-semibold text-brand-900">
        Alle Bereiche
      </h2>
      <button
        bind:this={closeButton}
        type="button"
        class="-mr-2 flex min-h-11 min-w-11 items-center justify-center rounded-sm p-2 text-neutral-700 hover:bg-[var(--color-brand-50)] hover:text-brand-900"
        aria-label="Schließen"
        onclick={closeSheet}
      >
        <svg
          aria-hidden="true"
          class="size-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg
        >
      </button>
    </div>
    <div id="staff-nav" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
      <StaffModuleSearch
        {groups}
        variant="sheet"
        {current}
        {ancestors}
        onnavigate={() => (open = false)}
      />

      <div class="mt-5 border-t border-neutral-300 pt-3 text-sm">
        <section aria-labelledby="staff-help-title">
          <h3 id="staff-help-title" class="m-0 text-sm font-semibold text-brand-900">
            Hilfe &amp; Kontakt
          </h3>
          <ul>
            <li>
              Technische Probleme:
              <a
                href="mailto:{HELP_CONTACTS.technik}"
                class="inline-flex min-h-11 items-center text-link">{HELP_CONTACTS.technik}</a
              >
            </li>
            <li>
              Alles andere:
              <a
                href="mailto:{HELP_CONTACTS.allgemein}"
                class="inline-flex min-h-11 items-center text-link">{HELP_CONTACTS.allgemein}</a
              >
            </li>
          </ul>
        </section>
        {#if authStore.principal}
          <p class="pt-1 text-neutral-700">
            Angemeldet als <span class="font-semibold">{authStore.principal.userDetails}</span>
          </p>
        {/if}
        <ul class="flex flex-wrap gap-x-6">
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
  </div>
{/if}

<svelte:window {onkeydown} />
<svelte:document {onfocusin} />

<style>
  /* Above the bar at the bottom; the bar itself stays visible */
  .staff-sheet {
    bottom: var(--staff-bar-h, 0px);
    max-height: calc(100dvh - var(--staff-bar-h, 0px) - 3rem);
  }
  .staff-sheet-scrim {
    bottom: var(--staff-bar-h, 0px);
    background: var(--dialog-backdrop, rgb(0 48 86 / 0.35));
  }
  .staff-bar-item {
    display: flex;
    min-height: 3.75rem;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    padding: 0.375rem 0.125rem 0.25rem;
    border-top: 3px solid transparent;
    color: var(--color-neutral-700);
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.1;
    text-align: center;
    text-decoration: none;
    hyphens: auto;
    overflow-wrap: break-word;
    cursor: pointer;
  }
  /* While the panel is open, „Menü“ is marked instead of the current page */
  .staff-bar-item[aria-expanded='true'] {
    border-top-color: var(--color-accent-500);
    color: var(--color-brand-900);
    font-weight: 700;
  }
  .sheet-open .staff-bar-item[aria-current] {
    border-top-color: transparent;
    color: var(--color-neutral-700);
    font-weight: 600;
  }
  .staff-bar-item[aria-current] {
    border-top-color: var(--color-accent-500);
    color: var(--color-brand-900);
    font-weight: 700;
  }
  .staff-bar-item:hover {
    color: var(--color-brand-900);
  }
</style>
