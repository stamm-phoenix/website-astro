<script lang="ts">
  import {
    favoritesStore,
    canChooseFavorites,
    toggleFavorite,
  } from '../lib/staffFavoritesStore.svelte';
  import { FAVORITE_STAR_PATH } from '../lib/favoriteStar';
  import { recentStore } from '../lib/staffRecentStore.svelte';
  import { CHANGELOG_PATH, type StaffModule } from '../lib/staffModuleTypes';
  import ChangelogBadge from './changelog/ChangelogBadge.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import InfoHint from './ui/InfoHint.svelte';

  interface Props {
    /** Favorites and recently used areas as they fill the tiles. */
    selected: StaffModule[];
    /** Every area the person may open. */
    available: StaffModule[];
  }
  let { selected, available }: Props = $props();

  const tileGrid = 'mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-8';
  const tileBase =
    'staff-tile min-w-0 border border-neutral-300 bg-surface text-center text-[0.8rem] leading-tight font-semibold text-brand-900 sm:text-sm';
  const tileLink = `${tileBase} flex h-full min-h-20 flex-col items-center justify-center gap-1.5 px-1 py-2`;

  interface PinnedTile {
    href: string;
    index: number;
  }
  // A tile keeps its place while it is pressed, even if the recent areas reorder meanwhile
  let pinned = $state<PinnedTile | null>(null);
  const visibleModules = $derived.by(() => {
    const result = [...selected];
    if (pinned) {
      const module = available.find(
        (entry) =>
          entry.href === pinned?.href &&
          (favoritesStore.modules.includes(entry.href) || recentStore.modules.includes(entry.href))
      );
      if (module) {
        const index = result.findIndex((entry) => entry.href === module.href);
        if (index >= 0) result.splice(index, 1);
        result.splice(pinned.index, 0, module);
      }
    }
    return result;
  });
  function pinTile(href: string): void {
    pinned = { href, index: visibleModules.findIndex((module) => module.href === href) };
  }
  function isFavorite(module: StaffModule): boolean {
    return favoritesStore.loaded && favoritesStore.modules.includes(module.href);
  }

  /** „Bearbeiten“ is only offered while there is a favorite to remove and the favorites can change. */
  const canEdit = $derived(canChooseFavorites() && visibleModules.some(isFavorite));
  let editRequested = $state(false);
  let editButton = $state<HTMLButtonElement | null>(null);
  const editing = $derived(editRequested && canEdit);
  $effect(() => {
    // The mode ends with the last favorite; a later favorite must not start in it
    if (!canEdit) editRequested = false;
  });

  function plainName(module: StaffModule): string {
    return (module.shortcut ?? module.title).replaceAll('|', '');
  }
</script>

{#snippet moduleTitle(module: StaffModule)}
  {#each (module.shortcut ?? module.wrap ?? module.title).split('|') as part, index (index)}{#if index > 0}<wbr
      />{/if}{part}{/each}
{/snippet}

{#snippet content(module: StaffModule)}
  <svg
    class="size-6 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"><path d={module.icon} /></svg
  >
  <span class="max-w-full break-words hyphens-auto">{@render moduleTitle(module)}</span>
{/snippet}

<section aria-labelledby="favorites-heading">
  <!-- As high as the button, so the tiles do not move down once it appears -->
  <div class="flex min-h-11 items-center gap-1">
    <h2 id="favorites-heading" class="font-serif text-lg font-semibold text-brand-900">
      Deine Bereiche
    </h2>
    <InfoHint label="Deine Bereiche" text="Deine Favoriten stehen auch in der unteren Leiste." />
    {#if canEdit}
      <ActionButton
        variant="secondary"
        class="ml-auto"
        bind:element={editButton}
        aria-pressed={editing}
        onclick={() => (editRequested = !editRequested)}
      >
        {editing ? 'Fertig' : 'Bearbeiten'}
      </ActionButton>
    {/if}
  </div>

  <ul class={tileGrid}>
    {#each visibleModules as module (module.href)}
      {@const favorite = isFavorite(module)}
      <li
        class="relative min-w-0"
        onfocusout={(event) => {
          if (
            pinned?.href === module.href &&
            (!(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget))
          )
            pinned = null;
        }}
      >
        {#if editing}
          <!-- Tiles do not open their area now; only favorites can be removed -->
          <div class="{tileBase} flex h-full min-h-20 flex-col">
            <div
              class="flex flex-1 flex-col items-center justify-center gap-1.5 px-1 py-2 {favorite
                ? ''
                : 'opacity-60'}"
            >
              {@render content(module)}
            </div>
            {#if favorite}
              <button
                type="button"
                class="flex min-h-11 w-full items-center justify-center gap-1 border-t border-neutral-300 px-1 text-[0.75rem] font-semibold text-brand-900 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-900"
                aria-label="{plainName(module)} aus deinen Favoriten entfernen"
                onclick={() => {
                  if (pinned?.href === module.href) pinned = null;
                  toggleFavorite(module.href, module.title);
                  // The focus stays close by instead of vanishing with the removed button
                  editButton?.focus();
                }}
              >
                <svg
                  aria-hidden="true"
                  class="size-4 shrink-0"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linejoin="round"><path d={FAVORITE_STAR_PATH} /></svg
                >
                Entfernen
              </button>
            {/if}
          </div>
        {:else}
          <a
            onfocus={() => pinTile(module.href)}
            onpointerdown={() => pinTile(module.href)}
            onpointercancel={() => {
              if (pinned?.href === module.href) pinned = null;
            }}
            onpointerleave={(event) => {
              if (
                pinned?.href === module.href &&
                !event.currentTarget.closest('li')?.contains(document.activeElement)
              )
                pinned = null;
            }}
            href={module.href}
            data-astro-reload={module.reload || undefined}
            class="{tileLink} no-underline hover:border-brand-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900"
          >
            {@render content(module)}
            {#if module.href === CHANGELOG_PATH}<ChangelogBadge floating />{/if}
          </a>
        {/if}
      </li>
    {/each}
  </ul>
</section>
