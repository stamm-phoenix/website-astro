<script lang="ts">
  import { onMount } from 'svelte';
  import { navigate } from 'astro:transitions/client';
  import { fetchNikolausStatus, nikolausStatusStore } from '../lib/nikolausStatusStore.svelte';
  import { searchStaffModules, type StaffModuleGroup } from '../lib/staffSearch';
  import { CHANGELOG_PATH, type StaffModule } from '../lib/staffModules';
  import { canOpenModule } from '../lib/staffAccess.svelte';
  import { favoriteToggle } from '../lib/staffFavoritesStore.svelte';
  import { longPress } from '../lib/longPress';
  import FavoriteStar from './FavoriteStar.svelte';
  import ChangelogBadge from './changelog/ChangelogBadge.svelte';
  import { CHANGELOG_SEEN_MAX_AGE_MS, loadChangelogSeen } from '../lib/staffChangelogStore.svelte';

  interface Props {
    groups: StaffModuleGroup[];
    /** `sidebar`: narrow list for the desktop; `sheet`: with descriptions; `start`: results only. */
    variant: 'sidebar' | 'sheet' | 'start';
    /** The current page and the pages above it, marked in the list. */
    current?: string;
    ancestors?: string[];
    /** Called when a module is chosen, e.g. to close the sheet. */
    onnavigate?: () => void;
    /** The search field, so the place can focus it (Strg+K). */
    input?: HTMLInputElement;
    /**
     * Modules of the Nikolausdienst, added to the group `nikolaus` while they are switched on;
     * for places whose groups are fixed at build time (the start page).
     */
    nikolausModules?: StaffModule[];
    /** Sidebar reduced to its icons: a search button instead of the field, no group names. */
    collapsed?: boolean;
    /** Called by the search button of the collapsed sidebar, which opens it for typing. */
    onexpand?: () => void;
  }

  let {
    groups,
    variant,
    current = '',
    ancestors = [],
    onnavigate,
    input = $bindable(),
    nikolausModules = [],
    collapsed = false,
    onexpand,
  }: Props = $props();

  const searchable = $derived(
    (nikolausModules.length > 0 && nikolausStatusStore.data?.staffActive
      ? groups.map((group) =>
          group.id === 'nikolaus'
            ? { ...group, modules: [...nikolausModules, ...group.modules] }
            : group
        )
      : groups
    ).map((group) => ({ ...group, modules: group.modules.filter(canOpenModule) }))
  );
  onMount(() => {
    if (nikolausModules.length > 0) void fetchNikolausStatus();
    void loadChangelogSeen({ maxAge: CHANGELOG_SEEN_MAX_AGE_MS });
  });

  const id = $props.id();
  let query = $state('');
  // The folded sidebar has no field, so no search may keep filtering its icons
  $effect(() => {
    if (collapsed) query = '';
  });
  const searching = $derived(query.trim().length > 0);
  const results = $derived(searchStaffModules(query, searchable));
  const count = $derived(results.reduce((sum, group) => sum + group.modules.length, 0));
  // The start page lists every area further down, so it only shows what matches
  const shown = $derived(variant === 'start' && !searching ? [] : results);

  function currentState(href: string): 'page' | 'true' | undefined {
    if (href === current) return 'page';
    return ancestors.includes(href) ? 'true' : undefined;
  }

  function open(module: StaffModule): void {
    onnavigate?.();
    query = '';
    if (module.reload) window.location.assign(module.href);
    else void navigate(module.href);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      const best = results[0]?.modules[0];
      if (searching && best) {
        event.preventDefault();
        open(best);
      }
    } else if (event.key === 'Escape' && query) {
      // The first Escape empties the field; the next one closes the sheet
      event.preventDefault();
      event.stopPropagation();
      query = '';
    }
  }
</script>

<div class="staff-search" data-variant={variant}>
  {#if collapsed}
    <button
      type="button"
      class="flex min-h-11 w-full items-center gap-3 px-2 text-brand-900 hover:bg-[var(--color-brand-50)] pointer-fine:min-h-10"
      aria-label="Bereich finden"
      data-flyout="Bereich finden · Strg K"
      data-flyout-icon="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5"
      onclick={onexpand}
    >
      <svg
        aria-hidden="true"
        class="size-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5" /></svg
      >
    </button>
  {:else}
    <label for="{id}-input" class="sr-only">Bereich finden</label>
    <div
      class="staff-fold flex items-center gap-2 border-[1.5px] border-[var(--field-border)] bg-[var(--color-field)] px-3 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--color-focus)] {variant ===
      'sidebar'
        ? 'min-h-11 pointer-fine:min-h-10'
        : 'min-h-12'}"
    >
      <svg
        aria-hidden="true"
        class="size-5 shrink-0 text-neutral-700"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5" /></svg
      >
      <input
        bind:this={input}
        bind:value={query}
        id="{id}-input"
        type="search"
        autocomplete="off"
        enterkeyhint="go"
        aria-describedby="{id}-status"
        placeholder={variant === 'sidebar' ? 'Bereich finden' : 'Bereich finden, z. B. Belege'}
        class="min-w-0 flex-1 border-0 bg-transparent py-2 text-base text-neutral-900 outline-none placeholder:text-neutral-700"
        {onkeydown}
      />
      {#if variant === 'sidebar' && !searching}
        <kbd
          class="hidden shrink-0 border border-neutral-300 px-1.5 text-xs text-neutral-700 pointer-fine:inline"
          >Strg K</kbd
        >
      {/if}
    </div>
  {/if}
  <p
    id="{id}-status"
    role="status"
    aria-live="polite"
    class="text-sm text-neutral-700 {searching ? 'mt-1.5' : 'sr-only'} {variant === 'sidebar'
      ? 'px-2'
      : ''}"
  >
    {#if searching && count === 0}
      Kein Bereich passt zu „{query.trim()}“.
    {:else if searching}
      {count === 1 ? '1 Bereich gefunden' : `${count} Bereiche gefunden`}
    {/if}
  </p>

  {#if shown.length > 0}
    <div class={variant === 'sidebar' ? 'mt-3 space-y-3' : 'mt-3 space-y-4'}>
      {#each shown as group (group.id)}
        <section aria-labelledby="{id}-{group.id}">
          <h3
            id="{id}-{group.id}"
            class="staff-fold m-0 text-xs font-semibold tracking-wide whitespace-nowrap text-neutral-700 uppercase transition-opacity motion-reduce:transition-none {variant ===
            'sidebar'
              ? 'px-2'
              : ''} {collapsed ? 'opacity-0' : ''}"
          >
            {group.title}
          </h3>
          <ul class={variant === 'start' ? 'surface mt-1 divide-y divide-neutral-200' : 'mt-1'}>
            {#each group.modules as module (module.href)}
              <li
                class="group relative flex items-center {variant === 'sheet'
                  ? 'border-b border-neutral-200'
                  : ''}"
              >
                <a
                  use:longPress={favoriteToggle(module)}
                  href={module.href}
                  data-astro-reload={module.reload || undefined}
                  aria-current={currentState(module.href)}
                  aria-describedby={module.href === CHANGELOG_PATH ? `${id}-news` : undefined}
                  data-flyout={variant === 'sidebar' ? module.title : undefined}
                  data-flyout-icon={variant === 'sidebar' ? module.icon : undefined}
                  onclick={() => {
                    onnavigate?.();
                    query = '';
                  }}
                  class="staff-search-link flex min-w-0 flex-1 items-center gap-3 text-brand-900 no-underline hover:underline {variant ===
                  'sidebar'
                    ? 'min-h-11 px-2 text-[0.95rem] pointer-fine:min-h-9'
                    : variant === 'sheet'
                      ? 'min-h-13 px-3 py-1.5'
                      : 'min-h-13 px-3 py-2'}"
                >
                  <svg
                    aria-hidden="true"
                    class="shrink-0 {variant === 'sidebar' ? 'size-4' : 'size-5'}"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d={module.icon} />
                  </svg>
                  {#if variant === 'sidebar'}
                    <span
                      class="staff-fold min-w-0 whitespace-nowrap transition-opacity motion-reduce:transition-none {collapsed
                        ? 'opacity-0'
                        : ''}">{module.title}</span
                    >
                  {:else}
                    <span class="min-w-0 flex-1">
                      <span class="block font-semibold">{module.title}</span>
                      <span class="block whitespace-normal text-sm text-neutral-700">
                        {module.description}
                      </span>
                    </span>
                  {/if}
                </a>
                {#if module.href === CHANGELOG_PATH}
                  <!-- Folded to its icons, the count sits on the corner of the icon and takes no room -->
                  <span class={collapsed ? 'pointer-events-none absolute top-0.5 left-5' : 'mr-1'}
                    ><ChangelogBadge textId="{id}-news" /></span
                  >
                {/if}
                {#if !collapsed}<FavoriteStar {module} compact={variant === 'sidebar'} />{/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* The sidebar marks the current area in bold; elsewhere the titles are bold anyway */
  [data-variant='sidebar'] .staff-search-link[aria-current] {
    font-weight: 600;
  }
  .staff-search-link[aria-current] {
    background: var(--color-brand-50);
    box-shadow: inset 3px 0 0 var(--color-accent-500);
  }
  /* The frame around field and icon shows the focus, not the field inside it */
  input:focus-visible {
    outline: none;
  }
  input[type='search']::-webkit-search-cancel-button {
    cursor: pointer;
  }
</style>
