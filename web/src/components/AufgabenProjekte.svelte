<script lang="ts">
  import AufgabenLadestatus from './AufgabenLadestatus.svelte';
  import { onMount } from 'svelte';
  import {
    aufgabenStore,
    loadTasks,
    taskProblem,
    TASK_ENDPOINT,
  } from '../lib/aufgabenStore.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import Toast from './ui/Toast.svelte';
  import AufgabenNavigation from './AufgabenNavigation.svelte';
  const data = $derived(aufgabenStore.data);
  let message = $state<string | null>(null);
  let editing = $state(false);
  function saved(result: string): void {
    editing = false;
    message = result;
  }
  import { tick } from 'svelte';
  import { sendApi } from '../lib/api';
  import type { TaskProject } from '../lib/types';
  import { fetchCampflowEvents } from '../lib/campflowStore.svelte';
  import AufgabenProjectDialog from './AufgabenProjectDialog.svelte';
  import ConfirmDialog from './ui/ConfirmDialog.svelte';
  let target = $state<TaskProject | null>(null);
  let deleteProjectTarget = $state<TaskProject | null>(null);
  let deleteError = $state<string | null>(null);
  let busy = $state(false);
  function edit(project: TaskProject | null = null): void {
    target = project;
    editing = true;
    message = null;
  }
  onMount(() => {
    void loadTasks();
    void fetchCampflowEvents();
  });
  async function removeProject(): Promise<void> {
    if (!deleteProjectTarget || busy) return;
    const project = deleteProjectTarget;
    busy = true;
    deleteError = null;
    message = null;
    try {
      await sendApi('DELETE', `${TASK_ENDPOINT}/projekte/${project.id}`, undefined, {
        etag: project.etag,
      });
      deleteProjectTarget = null;
      const refreshed = await loadTasks();
      message = refreshed
        ? 'Projekt gelöscht. Zugehörige Aufgaben bleiben erhalten.'
        : 'Projekt gelöscht. Die Ansicht konnte nicht aktualisiert werden. Bitte neu laden.';
      busy = false;
      await tick();
    } catch (e) {
      deleteError = taskProblem(e);
    } finally {
      busy = false;
    }
  }
</script>

<AufgabenLadestatus />
<a class="inline-flex min-h-11 items-center text-link" href="/leitendenbereich/aufgaben"
  >Zur Aufgabenliste</a
>
{#if data}
  <p class="my-3 text-neutral-700">Projekte bündeln Aufgaben für Aktionen und andere Vorhaben.</p>
  <ActionButton type="button" onclick={() => edit()} disabled={busy}>Projekt anlegen</ActionButton>
  <ul class="mt-4 divide-y divide-neutral-200">
    {#each data.projects as project (project.id)}
      {@const openCount = data.tasks.filter(
        (task) => task.projectId === project.id && task.state === 'offen'
      ).length}
      <li class="py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">{project.title}</h2>
          {#if project.campflowId}<a
              class="text-link"
              href="/leitendenbereich/aktionen/aktion?id={encodeURIComponent(project.campflowId)}"
              >CampFlow-Aktion öffnen</a
            >{:else}<p class="text-sm text-neutral-700">Eigenständiges Projekt</p>{/if}
          <p class="mt-1 text-sm text-neutral-700">
            {openCount}
            {openCount === 1 ? 'offene Aufgabe' : 'offene Aufgaben'}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <ActionButton
            type="button"
            variant="secondary"
            onclick={() => edit(project)}
            disabled={busy}>Projekt bearbeiten</ActionButton
          >
          <ActionButton
            type="button"
            variant="danger"
            disabled={busy}
            onclick={() => {
              deleteError = null;
              deleteProjectTarget = project;
            }}>Projekt löschen</ActionButton
          >
        </div>
      </li>
    {:else}<li class="py-4">
        Noch keine Projekte. Lege ein Projekt für eure nächste Aktion an.
      </li>{/each}
  </ul>
  <AufgabenNavigation area="projekte" />{/if}
{#if editing}<AufgabenProjectDialog
    {target}
    onclose={() => (editing = false)}
    onsaved={saved}
  />{/if}
<Toast {message} onclose={() => (message = null)} />
<ConfirmDialog
  open={deleteProjectTarget !== null}
  title={`Projekt „${deleteProjectTarget?.title ?? ''}“ löschen?`}
  {busy}
  error={deleteError}
  submitLabel="Projekt löschen"
  onclose={() => (deleteProjectTarget = null)}
  onconfirm={removeProject}
  onreload={async () => {
    const id = deleteProjectTarget?.id;
    busy = true;
    if (await loadTasks()) {
      deleteProjectTarget = aufgabenStore.data?.projects.find((item) => item.id === id) ?? null;
      deleteError = null;
    } else
      deleteError =
        'Das Projekt konnte nicht neu geladen werden. Prüfe deine Internetverbindung und tippe noch einmal auf „Aktuelle Fassung laden“.';
    busy = false;
  }}
>
  <p>Projekt „{deleteProjectTarget?.title ?? ''}“ wirklich löschen?</p>
  <p class="text-sm text-neutral-700">
    Die Aufgaben bleiben erhalten und werden „Ohne Projekt“ angezeigt. Vorlagen und die verknüpfte
    CampFlow-Aktion bleiben erhalten.
  </p>
</ConfirmDialog>
