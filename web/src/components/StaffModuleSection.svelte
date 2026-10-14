<script lang="ts">
  import { untrack } from 'svelte';
  import type { StaffModule } from '../lib/staffModules';

  interface Props {
    title: string;
    modules: StaffModule[];
    /** Only the starting state; afterwards the visitor opens and closes the section. */
    initiallyOpen?: boolean;
  }

  let { title, modules, initiallyOpen = false }: Props = $props();
  // Kept apart from the props, so a changing module list does not close an opened section
  let open = $state(untrack(() => initiallyOpen));
</script>

<details class="staff-section group mt-6" bind:open>
  <summary
    class="flex min-h-12 cursor-pointer flex-wrap items-baseline gap-x-3 border-b border-neutral-300 py-3"
  >
    <h2 class="m-0 inline text-xl text-brand-900">{title}</h2>
    <!-- Closed, the summary names its modules, so a module is found without opening each section.
         CSS switches the text, because the start page renders this section without JavaScript. -->
    <span class="text-sm text-neutral-700 group-open:hidden">
      {modules.map((module) => module.title).join(', ')}
    </span>
    <span class="hidden text-sm text-neutral-700 group-open:inline">
      {modules.length === 1 ? '1 Bereich' : `${modules.length} Bereiche`}
    </span>
  </summary>
  <ul class="grid md:grid-cols-2 md:gap-x-10">
    {#each modules as module (module.href)}
      <li class="border-b border-neutral-200">
        <a
          href={module.href}
          data-astro-reload={module.reload || undefined}
          class="group flex h-full gap-3 py-4 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900"
        >
          <svg
            class="mt-0.5 size-5 shrink-0 text-brand-900"
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
          <span>
            <span class="block font-semibold text-brand-900 group-hover:underline">
              {module.title}
            </span>
            <span class="mt-0.5 block text-sm text-neutral-700">{module.description}</span>
          </span>
        </a>
      </li>
    {/each}
  </ul>
</details>
