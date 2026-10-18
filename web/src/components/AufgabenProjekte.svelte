<script lang="ts">
  import AufgabenLadestatus from './AufgabenLadestatus.svelte';
  import { onMount } from 'svelte';
  import { aufgabenStore, loadTasks } from '../lib/aufgabenStore.svelte';
  import { taskProjects } from '../lib/aufgabenView';
  import type { TaskProject } from '../lib/types';
  import ActionButton from './ui/ActionButton.svelte';
  import Toast from './ui/Toast.svelte';
  import AufgabenNavigation from './AufgabenNavigation.svelte';
  import AufgabenProjectDialog from './AufgabenProjectDialog.svelte';
  const data = $derived(aufgabenStore.data);
  const projects = $derived(taskProjects(data?.tasks ?? []));
  let message = $state<string | null>(null);
  let target = $state<TaskProject | null>(null);
  function saved(result: string): void {
    target = null;
    message = result;
  }
  onMount(() => {
    void loadTasks();
  });
</script>

<AufgabenLadestatus />
<a
  class="inline-flex min-h-11 items-center text-link"
  href="/leitendenbereich/aufgaben"
  data-astro-reload>Zur Aufgabenliste</a
>
{#if data}
  <p class="my-3 text-neutral-700">
    Projekte entstehen von selbst: Gib beim Anlegen einer Aufgabe ein Projekt an. Ein Projekt
    verschwindet wieder, wenn keine Aufgabe mehr darin steht.
  </p>
  <ul class="mt-4 divide-y divide-neutral-200">
    {#each projects as project (project.title)}
      <li class="py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">{project.title}</h2>
          <p class="mt-1 text-sm text-neutral-700">
            {project.open}
            {project.open === 1 ? 'offene Aufgabe' : 'offene Aufgaben'}, {project.done} erledigt
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a
            class="inline-flex min-h-11 items-center text-link"
            href="/leitendenbereich/aufgaben?projekt={encodeURIComponent(project.title)}"
            data-astro-reload>Aufgaben ansehen</a
          >
          <ActionButton
            type="button"
            variant="secondary"
            onclick={() => {
              message = null;
              target = project;
            }}>Projekt umbenennen</ActionButton
          >
        </div>
      </li>
    {:else}<li class="py-4">
        Noch keine Projekte. Ordne eine Aufgabe einem Projekt zu, dann erscheint es hier.
      </li>{/each}
  </ul>
  <AufgabenNavigation area="projekte" />{/if}
{#if target}<AufgabenProjectDialog {target} onclose={() => (target = null)} onsaved={saved} />{/if}
<Toast {message} onclose={() => (message = null)} />
