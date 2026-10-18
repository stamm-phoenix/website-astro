<script lang="ts">
  import { onMount } from 'svelte';
  import ModalDialog from './ui/ModalDialog.svelte';
  import StaffModuleSearch from './StaffModuleSearch.svelte';
  import { authStore, fetchPrincipal } from '../lib/authStore.svelte';
  import { fetchNikolausStatus, nikolausStatusStore } from '../lib/nikolausStatusStore.svelte';
  import { favoritesStore, loadFavorites } from '../lib/staffFavoritesStore.svelte';
  import { loadRecent, recentStore, recordVisit } from '../lib/staffRecentStore.svelte';
  import { STAFF_DEFAULT_QUICK, STAFF_HOME, type StaffModule } from '../lib/staffModules';
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

  /** Areas in the bar between „Übersicht“ and „Alle“. */
  const QUICK_COUNT = 3;
  const allModules = $derived([
    ...sections.flatMap((section) => section.modules),
    nikolausControl,
    ...nikolausModules,
  ]);
  const groups = $derived<StaffModuleGroup[]>([
    ...sections,
    {
      id: 'nikolaus',
      title: 'Nikolausdienst',
      modules: [...(nikolausStatusStore.data?.staffActive ? nikolausModules : []), nikolausControl],
    },
  ]);

  // Favorites first, then the recently used areas, filled up with the usual ones
  // Without favorites (load failed, login not checked) the bar still fills up
  const ready = $derived(
    recentStore.loaded &&
      (favoritesStore.loaded ||
        favoritesStore.loadError !== null ||
        (authStore.error && !authStore.principal))
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

  // Once shown, the bar keeps its areas while the start page loads the favorites again
  let shownQuick = $state<StaffModule[] | null>(null);
  $effect(() => {
    if (ready) shownQuick = quick;
  });

  let open = $state(false);

  function isCurrent(href: string): boolean {
    return href === current || ancestors.includes(href);
  }
  const home = $derived(current === STAFF_HOME.href);
  // The current page is highlighted in the bar; „Alle“ stands in for modules not in it
  const inBar = $derived(home || (shownQuick ?? []).some((entry) => isCurrent(entry.href)));

  onMount(() => {
    if (module) void recordVisit(module);
    else void loadRecent();
    void fetchPrincipal();
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
      void loadFavorites(
        userId,
        allModules.map((entry) => entry.href)
      );
    }
  });

  function openSheet(): void {
    open = true;
    // Only asked for when the sheet is used, so a page load costs no extra request
    void fetchNikolausStatus();
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
  aria-label="Schnellzugriff"
  class="staff-bottom-bar fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-neutral-300 bg-surface pb-[env(safe-area-inset-bottom)] print:hidden lg:hidden"
>
  <a href={STAFF_HOME.href} aria-current={home ? 'page' : undefined} class="staff-bar-item">
    {@render icon('M3 11l9-8 9 8M5 10v10h14V10')}
    <span>Übersicht</span>
  </a>
  {#if shownQuick}
    {#each shownQuick as entry (entry.href)}
      <a
        href={entry.href}
        data-astro-reload={entry.reload || undefined}
        aria-current={entry.href === current ? 'page' : isCurrent(entry.href) ? 'true' : undefined}
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
    aria-label="Alle Bereiche"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-current={inBar ? undefined : 'true'}
    onclick={openSheet}
  >
    {@render icon('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z')}
    <span>Alle</span>
  </button>
</nav>

<ModalDialog {open} title="Alle Bereiche" sheet dismissOnBackdrop onclose={() => (open = false)}>
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
</ModalDialog>

<style>
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
  .staff-bar-item[aria-current] {
    border-top-color: var(--color-accent-500);
    color: var(--color-brand-900);
    font-weight: 700;
  }
  .staff-bar-item:hover {
    color: var(--color-brand-900);
  }
</style>
