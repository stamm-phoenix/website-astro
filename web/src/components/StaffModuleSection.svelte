<script lang="ts">
  import type { StaffModule } from '../lib/staffModules';

  interface Props {
    title: string;
    modules: StaffModule[];
  }

  let { title, modules }: Props = $props();
  const id = $props.id();
</script>

{#snippet moduleTitle(module: StaffModule)}
  {#each (module.wrap ?? module.title).split('|') as part, index (index)}{#if index > 0}<wbr
      />{/if}{part}{/each}
{/snippet}

<!-- Always open: every area is one tap away, without opening sections first -->
<section aria-labelledby={id} class="staff-section mt-5">
  <h3 {id} class="m-0 text-xs font-semibold tracking-wide text-neutral-700 uppercase">{title}</h3>
  <ul class="grid grid-cols-2 gap-x-4 md:grid-cols-3">
    {#each modules as module (module.href)}
      <li class="min-w-0 border-b border-neutral-200">
        <a
          href={module.href}
          data-astro-reload={module.reload || undefined}
          class="group flex h-full min-h-12 items-center gap-2.5 py-2 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900 sm:items-start sm:py-3"
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
              class="block font-semibold break-words text-brand-900 hyphens-auto group-hover:underline"
            >
              {@render moduleTitle(module)}
            </span>
            <!-- On a phone the search above names what each area is for -->
            <span class="mt-0.5 hidden text-sm text-neutral-700 sm:block">{module.description}</span
            >
          </span>
        </a>
      </li>
    {/each}
  </ul>
</section>
