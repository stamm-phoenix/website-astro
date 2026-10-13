<script lang="ts">
  import { aufgabenStore } from '../lib/aufgabenStore.svelte';
  import FormField from './pflege/FormField.svelte';
  let {
    projectFilter = $bindable('alle'),
    ownOnly = $bindable(false),
    onchange = () => {},
  }: { projectFilter?: string; ownOnly?: boolean; onchange?: () => void } = $props();
  let filtersOpen = $state(false);
  const activeFilters = $derived(Number(projectFilter !== 'alle') + Number(ownOnly));
</script>

<details bind:open={filtersOpen} class="my-3">
  <summary class="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand-900"
    >Filter ({activeFilters} aktiv)</summary
  >
  <div role="group" aria-label="Aufgabenfilter" class="my-3 flex flex-wrap items-end gap-3">
    <FormField id="task-project-filter" label="Projekt"
      >{#snippet children(attrs)}
        <select {...attrs} class="form-input" bind:value={projectFilter} {onchange}
          ><option value="alle">Alle Projekte</option><option value="">Ohne Projekt</option
          >{#each aufgabenStore.data?.projects ?? [] as project (project.id)}<option
              value={String(project.id)}>{project.title}</option
            >{/each}</select
        >
      {/snippet}</FormField
    >
    <label class="flex items-center gap-3 min-h-11 cursor-pointer py-2"
      ><input
        type="checkbox"
        class="person-switch shrink-0"
        role="switch"
        bind:checked={ownOnly}
        {onchange}
      /> Nur mir zugewiesen</label
    >
  </div>
</details>

<style>
  .person-switch {
    appearance: none;
    position: relative;
    width: 2.75rem;
    height: 1.5rem;
    border: 1px solid var(--color-neutral-400);
    border-radius: 999px;
    background: var(--color-neutral-300);
    cursor: pointer;
  }
  .person-switch::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--color-neutral-50);
  }
  .person-switch:checked {
    background: var(--color-link);
    border-color: var(--color-link);
  }
  .person-switch:checked::before {
    transform: translateX(20px);
  }
</style>
