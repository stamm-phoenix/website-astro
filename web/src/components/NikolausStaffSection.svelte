<script lang="ts">
  import { untrack } from 'svelte';
  import { fetchNikolausStatus, nikolausStatusStore } from '../lib/nikolausStatusStore.svelte';
  import { NIKOLAUS_CONTROL_MODULE, NIKOLAUS_MODULES } from '../lib/staffModules';

  // The Steuerung is always there; the other modules only while they are switched on
  const modules = $derived([
    ...(nikolausStatusStore.data?.staffActive ? NIKOLAUS_MODULES : []),
    NIKOLAUS_CONTROL_MODULE,
  ]);

  $effect(() => {
    untrack(() => fetchNikolausStatus());
  });
</script>

<details class="staff-section mt-6">
  <summary
    class="flex min-h-12 cursor-pointer items-center gap-3 border-b border-neutral-300 py-3 font-serif text-xl font-bold text-brand-900"
  >
    Nikolausdienst
    <span class="font-sans text-sm font-normal text-neutral-700">
      {modules.length === 1 ? '1 Bereich' : `${modules.length} Bereiche`}
    </span>
  </summary>
  <ul class="mt-3 grid border-b border-neutral-200 md:grid-cols-2 md:gap-x-10">
    {#each modules as module (module.href)}
      <li class="border-t border-neutral-200">
        <a
          href={module.href}
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
