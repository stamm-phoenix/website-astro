<script lang="ts">
  import { aufgabenStore } from '../lib/aufgabenStore.svelte';
  import { pendingTask } from '../lib/aufgabenView';
  let { area = 'aufgaben' }: { area?: string } = $props();
  const items = $derived([
    {
      path: 'vorschlaege',
      value: 'vorschlag',
      label: 'Vorschläge',
      description: 'Aufgaben aus Protokollen prüfen',
      count: aufgabenStore.data?.tasks.filter(pendingTask).length ?? 0,
    },
    {
      path: 'projekte',
      value: 'projekte',
      label: 'Projekte',
      description: 'Vorhaben und ihre Aufgaben verwalten',
      count: aufgabenStore.data?.projects.length ?? 0,
    },
    {
      path: 'vorlagen',
      value: 'vorlagen',
      label: 'Vorlagen',
      description: 'Wiederverwendbare Checklisten verwalten',
      count: aufgabenStore.data?.templates.length ?? 0,
    },
  ]);
</script>

<nav aria-label="Planung und Verwaltung" class="mt-8 border-t border-neutral-200 pt-5">
  <h2 class="mb-3 text-lg font-semibold">Planung und Verwaltung</h2>
  <div class="grid gap-3 sm:grid-cols-3">
    {#each items as item (item.value)}
      <a
        href="/leitendenbereich/aufgaben/{item.path}"
        data-astro-reload
        aria-current={area === item.value ? 'page' : undefined}
        aria-label={item.label}
        class="surface rounded-lg p-4 text-link"
      >
        <span class="font-semibold">{item.label}</span><span
          aria-hidden="true"
          class="ml-1 text-sm text-neutral-700">({item.count})</span
        >
        <span class="mt-1 block text-sm text-neutral-700">{item.description}</span>
      </a>
    {/each}
  </div>
</nav>
