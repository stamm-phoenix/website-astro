<script lang="ts">
  import { onMount } from 'svelte';
  import { aufgabenStore, loadTasks, loadTaskUsers } from '../lib/aufgabenStore.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';
  import Toast from './ui/Toast.svelte';
  import AufgabenNavigation from './AufgabenNavigation.svelte';
  const data = $derived(aufgabenStore.data);
  let message = $state<string | null>(null);
  let editing = $state(false);
  function saved(result: string): void {
    editing = false;
    message = result;
  }
  import type { TaskTemplate } from '../lib/types';
  import AufgabenTemplateDialog from './AufgabenTemplateDialog.svelte';
  let target = $state<TaskTemplate | null>(null);
  const busy = false;
  function edit(template: TaskTemplate | null = null): void {
    target = template;
    editing = true;
    message = null;
  }
  onMount(() => {
    void loadTasks();
    void loadTaskUsers();
  });
</script>

<StatusNotice kind="error" message={aufgabenStore.error} popup />
<a
  class="inline-flex min-h-11 items-center text-link"
  href="/leitendenbereich/aufgaben"
  data-astro-reload>Zur Aufgabenliste</a
>
{#if data}
  <p class="my-3 text-neutral-700">
    Vorlagen sind wiederverwendbar. Fristen beziehen sich auf das Datum der Aktion.
  </p>
  <ActionButton type="button" onclick={() => edit()} disabled={busy}>Vorlage anlegen</ActionButton>
  <ul class="mt-4 divide-y divide-neutral-200">
    {#each data.templates as template (template.id)}
      <li class="py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">{template.title}</h2>
          <p>{template.items.length} {template.items.length === 1 ? 'Aufgabe' : 'Aufgaben'}</p>
        </div>
        <ActionButton
          type="button"
          variant="secondary"
          onclick={() => edit(template)}
          disabled={busy}>Vorlage bearbeiten</ActionButton
        >
      </li>
    {:else}<li class="py-4">
        Noch keine Vorlagen. Lege eine Checkliste für wiederkehrende Aktionen an.
      </li>{/each}
  </ul>
  <AufgabenNavigation area="vorlagen" />{/if}
{#if editing}<AufgabenTemplateDialog
    {target}
    onclose={() => (editing = false)}
    onsaved={saved}
  />{/if}
<Toast {message} onclose={() => (message = null)} />
