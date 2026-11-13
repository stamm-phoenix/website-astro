<script lang="ts">
  import { CHANGELOG_PATH, type StaffModule } from '../lib/staffModuleTypes';
  import ChangelogBadge from './changelog/ChangelogBadge.svelte';
  import { favoriteToggle } from '../lib/staffFavoritesStore.svelte';
  import { longPress } from '../lib/longPress';
  import FavoriteStar from './FavoriteStar.svelte';
  import { canOpenModule } from '../lib/staffAccess.svelte';

  interface Props {
    title: string;
    modules: StaffModule[];
    level?: 2 | 3;
  }

  let { title, modules, level = 3 }: Props = $props();
  const id = $props.id();
</script>

{#snippet moduleTitle(module: StaffModule)}
  {#each (module.wrap ?? module.title).split('|') as part, index (index)}{#if index > 0}<wbr
      />{/if}{part}{/each}
{/snippet}

<!-- Always open: every area is one tap away, without opening sections first -->
<section aria-labelledby={id} class="staff-section mt-5">
  <svelte:element
    this={level === 2 ? 'h2' : 'h3'}
    {id}
    class={level === 2
      ? 'm-0 font-serif text-lg font-semibold text-brand-900'
      : 'm-0 text-xs font-semibold tracking-wide text-neutral-700 uppercase'}
    >{title}</svelte:element
  >
  <ul class="grid gap-x-4 sm:grid-cols-2 md:grid-cols-3">
    {#each modules.filter(canOpenModule) as module (module.href)}
      <li class="group flex min-w-0 items-center border-b border-neutral-200">
        <a
          use:longPress={favoriteToggle(module)}
          href={module.href}
          data-astro-reload={module.reload || undefined}
          class="group/link flex h-full min-h-12 min-w-0 flex-1 items-center gap-2.5 py-2 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900 sm:items-start sm:py-3"
        >
          <svg
            class="size-5 shrink-0 text-brand-900 sm:mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d={module.icon} />
          </svg>
          <span class="min-w-0">
            <span
              class="block font-semibold break-words text-brand-900 hyphens-auto group-hover/link:underline"
            >
              {@render moduleTitle(module)}
              {#if module.href === CHANGELOG_PATH}<ChangelogBadge />{/if}
            </span>
            <span class="mt-0.5 block text-sm text-neutral-700">{module.description}</span>
          </span>
        </a>
        <FavoriteStar {module} />
      </li>
    {/each}
  </ul>
</section>
