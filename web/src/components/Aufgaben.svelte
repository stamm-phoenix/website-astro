<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Task } from '../lib/types';
  import {
    aufgabenStore,
    loadTasks,
    loadTaskUsers,
    TASK_PRESENTATION_KEY,
  } from '../lib/aufgabenStore.svelte';
  import { createTaskActions } from '../lib/aufgabenActions.svelte';
  import { matchesTaskFilters, pendingTask, sortTasks } from '../lib/aufgabenView';
  import { campflowEventsStore, fetchCampflowEvents } from '../lib/campflowStore.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import FilterTabs from './ui/FilterTabs.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';
  import AufgabenFilter from './AufgabenFilter.svelte';
  import AufgabenListe from './AufgabenListe.svelte';
  import AufgabenNavigation from './AufgabenNavigation.svelte';
  import AufgabenAktionen from './AufgabenAktionen.svelte';
  import AufgabenTaskDialog from './AufgabenTaskDialog.svelte';
  import AufgabenChecklistDialog from './AufgabenChecklistDialog.svelte';
  import AufgabenProjectDialog from './AufgabenProjectDialog.svelte';
  let presentation = $state('liste');
  let statusFilter = $state('offen');
  let projectFilter = $state('alle');
  let ownOnly = $state(false);
  let addButton = $state<HTMLButtonElement | null>(null);
  let editing = $state(false);
  let target = $state<Task | null>(null);
  let checklist = $state(false);
  let projectAction = $state<string | null>(null);
  let menuTarget = $state<Task | null>(null);
  const data = $derived(aufgabenStore.data);
  const actions = createTaskActions(() => addButton?.focus());
  const busy = $derived(actions.state.busy);
  const filtered = $derived(
    (data?.tasks ?? []).filter(
      (task) =>
        ['offen', 'erledigt'].includes(task.state) &&
        matchesTaskFilters(task, { project: projectFilter, own: ownOnly, login: data?.login })
    )
  );
  const visible = $derived(
    sortTasks(filtered.filter((task) => statusFilter === 'alle' || task.state === statusFilter))
  );
  const pending = $derived(data?.tasks.filter(pendingTask).length ?? 0);
  const statusOptions = $derived(
    ['alle', 'offen', 'erledigt'].map((value) => ({
      value,
      label: value === 'alle' ? 'Alle' : value === 'offen' ? 'Offen' : 'Erledigt',
      count: filtered.filter((task) => value === 'alle' || task.state === value).length,
    }))
  );
  function edit(task: Task | null = null): void {
    target = task;
    editing = true;
    actions.showMessage(null);
  }
  function saved(message: string): void {
    editing = false;
    checklist = false;
    projectAction = null;
    actions.showMessage(message);
  }
  function selectPresentation(value: string): void {
    presentation = value;
    try {
      localStorage.setItem(TASK_PRESENTATION_KEY, value);
    } catch {
      /* Optional device preference. */
    }
  }
  onMount(() => {
    try {
      const saved =
        localStorage.getItem(TASK_PRESENTATION_KEY) ??
        localStorage.getItem('phoenix-task-presentation');
      if (saved === 'liste' || saved === 'kanban') presentation = saved;
    } catch {
      /* Keep default. */
    }
    const params = new URLSearchParams(location.search);
    if (params.has('protokoll')) {
      location.replace(`/leitendenbereich/aufgaben/vorschlaege${location.search}`);
      return;
    }
    void loadTaskUsers();
    void Promise.all([loadTasks(), fetchCampflowEvents()]).then(async () => {
      await tick();
      if (location.hash.startsWith('#aufgabe-'))
        document.getElementById(location.hash.slice(1))?.scrollIntoView();
      const action = params.get('aktion');
      if (!action) return;
      const project = aufgabenStore.data?.projects.find((project) => project.campflowId === action);
      if (project) projectFilter = String(project.id);
      else projectAction = action;
    });
  });
</script>

<StatusNotice message={actions.state.error ?? aufgabenStore.error} kind="error" popup />
{#if aufgabenStore.loading && !data}<p role="status">Aufgaben werden geladen …</p>{/if}
{#if aufgabenStore.error}<ActionButton onclick={loadTasks} disabled={busy}>Neu laden</ActionButton
  >{/if}
{#if data}
  {#if pending > 0}<a
      href="/leitendenbereich/aufgaben/vorschlaege"
      data-astro-reload
      class="mb-3 inline-flex min-h-11 items-center gap-2 text-link"
      ><span
        class="rounded-full bg-[var(--color-warning-soft)] px-2 py-0.5 text-sm font-semibold text-warning"
        >{pending}</span
      >{pending === 1 ? 'Aufgabenvorschlag prüfen' : 'Aufgabenvorschläge prüfen'}</a
    >{/if}
  <div class="mb-3 flex flex-wrap gap-2">
    <ActionButton
      bind:element={addButton}
      data-focus-fallback
      variant="primary"
      onclick={() => edit()}
      disabled={busy}>Aufgabe anlegen</ActionButton
    >
    <ActionButton
      variant="secondary"
      onclick={() => (checklist = true)}
      disabled={busy || !data.projects.length || !data.templates.length}
      >Checkliste aus Vorlage</ActionButton
    >
  </div>
  <div class="mb-3 flex flex-wrap gap-2 sm:gap-3">
    <FilterTabs
      variant="segmented"
      label="Darstellung"
      options={[
        { value: 'liste', label: 'Liste' },
        { value: 'kanban', label: 'Kanban' },
      ]}
      value={presentation}
      onselect={selectPresentation}
    />
    <FilterTabs
      variant="segmented"
      label="Status"
      options={statusOptions}
      value={statusFilter}
      onselect={(value) => (statusFilter = value)}
      countNouns={['Aufgabe', 'Aufgaben']}
    />
  </div>
  <AufgabenFilter bind:projectFilter bind:ownOnly />
  <AufgabenListe
    {visible}
    {presentation}
    {statusFilter}
    view={statusFilter}
    {projectFilter}
    {ownOnly}
    {busy}
    onopen={edit}
    ontoggle={(task) => actions.taskAction(task, 'toggle')}
    onmenu={(task) => (menuTarget = task)}
  />
  <AufgabenNavigation />
{/if}
{#if editing}<AufgabenTaskDialog {target} onclose={() => (editing = false)} onsaved={saved} />{/if}
{#if checklist}<AufgabenChecklistDialog
    initialProjectId={projectFilter === 'alle' ? null : Number(projectFilter)}
    onclose={() => (checklist = false)}
    onsaved={saved}
  />{/if}
{#if projectAction !== null}<AufgabenProjectDialog
    initialCampflowId={projectAction}
    initialTitle={campflowEventsStore.data?.find((event) => event.id === projectAction)?.title ??
      ''}
    onclose={() => (projectAction = null)}
    onsaved={saved}
  />{/if}
<AufgabenAktionen {actions} bind:menuTarget onedit={edit} />
