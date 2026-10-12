<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ApiError, fetchApi, sendApi } from '../lib/api';
  import type {
    Task,
    TaskAssignment,
    TaskInput,
    TaskProject,
    TaskTemplate,
    TemplateItem,
    TasksOverview,
    StaffProtokolleData,
  } from '../lib/types';
  import { campflowEventsStore, fetchCampflowEvents } from '../lib/campflowStore.svelte';
  import {
    taskAssigneeLogin,
    taskHasAssignee,
    taskPeople,
    taskAssigneeNames,
    type SharePointSiteUser,
  } from '../../../api/lib/aufgaben-zuordnung';
  import { localDate } from '../lib/dateUtils';
  import ActionButton from './ui/ActionButton.svelte';
  import FilterTabs from './ui/FilterTabs.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';
  import AufgabenDialog from './AufgabenDialog.svelte';
  import EditDialog from './pflege/EditDialog.svelte';
  import FormField from './pflege/FormField.svelte';

  const endpoint = '/intern/pflege/aufgaben';
  const proposalDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' });
  let data = $state<TasksOverview | null>(null);
  let users = $state<SharePointSiteUser[]>([]);
  let usersLoading = $state(true);
  let usersUnavailable = $state(false);
  let protocols = $state<StaffProtokolleData | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);
  let recognitionMessage = $state<string | null>(null);
  let recognitionError = $state<string | null>(null);
  let recognitionRequest = 0;
  let protocolError = $state<string | null>(null);
  let view = $state('offen');
  let projectFilter = $state('alle');
  let ownOnly = $state(false);
  let sourceId = $state('');
  let addButton = $state<HTMLButtonElement | null>(null);
  let dialog = $state<'task' | 'project' | 'template' | 'checklist' | null>(null);
  let target = $state<Task | TaskProject | TaskTemplate | null>(null);
  let dialogError = $state<string | null>(null);
  let deleteTarget = $state<Task | null>(null);
  let deleteError = $state<string | null>(null);
  let assignmentLoading = $state(false);
  let assignmentMessage = $state<string | null>(null);
  let assignmentRequest = 0;
  let assignmentEdited = false;
  let fields = $state<Record<string, string>>({});
  let draft = $state<TaskInput>({
    title: '',
    description: '',
    assignee: '',
    dueDate: null,
    projectId: null,
  });
  let campflowId = $state('');
  let items = $state<TemplateItem[]>([]);
  let templateId = $state<number | null>(null);
  let date = $state(localDate());
  const tabs = [
    { value: 'offen', label: 'Offen' },
    { value: 'erledigt', label: 'Erledigt' },
    { value: 'vorschlag', label: 'Vorschläge' },
    { value: 'kanban', label: 'Kanban' },
    { value: 'projekte', label: 'Projekte' },
    { value: 'vorlagen', label: 'Vorlagen' },
  ];
  const boardColumns = [
    { value: 'vorschlag', label: 'Vorschläge' },
    { value: 'offen', label: 'Offen' },
    { value: 'erledigt', label: 'Erledigt' },
  ];
  const visible = $derived(
    (data?.tasks ?? [])
      .filter(
        (task) =>
          (view === 'kanban'
            ? boardColumns.some((column) => column.value === task.state)
            : task.state === view) &&
          (task.state !== 'vorschlag' ||
            !task.dueDate ||
            task.dueDate >= proposalDay.format(new Date())) &&
          (view !== 'vorschlag' || !sourceId || task.sourceId === sourceId) &&
          (projectFilter === 'alle' || String(task.projectId ?? '') === projectFilter) &&
          (!ownOnly || taskHasAssignee(task, data?.login))
      )
      .sort(
        (a, b) =>
          (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
          a.title.localeCompare(b.title, 'de')
      )
  );
  const eligible = $derived(
    (protocols?.items ?? [])
      .filter(
        (p) => ['Freigegeben', 'Verschickt', 'Archiv'].includes(p.status) && !p.changedSinceApproval
      )
      .sort((a, b) => b.date.localeCompare(a.date))
  );
  const source = $derived(eligible.find((p) => p.id === sourceId));
  /** Clear old recognition results when continuing work or changing the source/filter. */
  function clearRecognition(): void {
    recognitionRequest += 1;
    recognitionMessage = null;
    recognitionError = null;
  }
  /** German calendar labels without timezone-dependent day shifts. */
  function protocolLabel(date: string): string {
    const parsed = new Date(`${date}T12:00:00Z`);
    return Number.isNaN(parsed.getTime())
      ? date
      : new Intl.DateTimeFormat('de-DE', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(parsed);
  }
  /** Show field-level API errors when available, otherwise a safe fallback message. */
  function problem(e: unknown): string {
    return e instanceof ApiError
      ? (e.fields?.form ?? e.message)
      : 'Die Daten konnten nicht geladen oder gespeichert werden.';
  }
  /** Refresh task data and reviewer permissions independently of protocol availability. */
  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      data = await fetchApi<TasksOverview>(endpoint);
    } catch (e) {
      error = problem(e);
    } finally {
      loading = false;
    }
  }
  /** Load sources for recognition without blocking task edits or proposal rejection. */
  async function loadProtocols(): Promise<void> {
    protocolError = null;
    try {
      protocols = await fetchApi<StaffProtokolleData>('/intern/pflege/protokolle');
    } catch (e) {
      protocolError = problem(e);
    }
  }
  /** Load assignment suggestions independently of tasks and keep manual editing available. */
  async function loadUsers(): Promise<void> {
    try {
      const result = await fetchApi<{ users: SharePointSiteUser[]; unavailable: boolean }>(
        `${endpoint}/benutzer`
      );
      users = result.users;
      usersUnavailable = result.unavailable;
    } catch {
      usersUnavailable = true;
    } finally {
      usersLoading = false;
    }
  }
  onMount(() => {
    void loadUsers();
    sourceId = new URLSearchParams(location.search).get('protokoll') ?? '';
    if (sourceId) view = 'vorschlag';
    const initialLoad = load().then(async () => {
      await tick();
      if (location.hash.startsWith('#aufgabe-'))
        document.getElementById(location.hash.slice(1))?.scrollIntoView();
    });
    void Promise.all([initialLoad, fetchCampflowEvents()]).then(() => {
      const action = new URLSearchParams(location.search).get('aktion');
      if (!action) return;
      const project = data?.projects.find((p) => p.campflowId === action);
      if (project) {
        projectFilter = String(project.id);
        return;
      }
      view = 'projekte';
      open('project');
      campflowId = action;
      draft.title = campflowEventsStore.data?.find((e) => e.id === action)?.title ?? '';
    });
    void loadProtocols();
  });
  /** Initialize a fresh dialog draft without mutating the loaded task or template. */
  function open(kind: typeof dialog, entry: typeof target = null): void {
    clearRecognition();
    message = null;
    assignmentRequest += 1;
    assignmentEdited = false;
    assignmentLoading = false;
    assignmentMessage = null;
    dialog = kind;
    target = entry;
    dialogError = null;
    fields = {};
    draft = {
      title: entry?.title ?? '',
      description: '',
      assignee: '',
      dueDate: null,
      projectId: null,
    };
    if (entry && 'state' in entry)
      draft = {
        title: entry.title,
        description: entry.description,
        assignee: entry.assignee,
        assignees: taskPeople(entry, users),
        dueDate: entry.dueDate,
        projectId: entry.projectId,
      };
    campflowId = entry && 'campflowId' in entry ? entry.campflowId : '';
    items =
      entry && 'items' in entry
        ? entry.items.map((item) => ({ ...item }))
        : [{ title: '', description: '', assignee: '', daysBefore: 14 }];
    templateId = data?.templates[0]?.id ?? null;
    if (kind === 'checklist' && projectFilter !== 'alle') draft.projectId = Number(projectFilter);
    date = localDate();
  }
  /** Resolve existing @mentions without overwriting a reviewer edit or a later dialog. */
  async function review(task: Task): Promise<void> {
    open('task', task);
    if (!task.assignee || !task.quote.includes('@')) return;
    const sequence = assignmentRequest;
    const originalPeople = JSON.stringify(draft.assignees);
    assignmentLoading = true;
    try {
      const result = await sendApi<TaskAssignment>('POST', `${endpoint}/${task.id}/zuordnung`, {
        etag: task.etag,
      });
      if (sequence !== assignmentRequest || dialog !== 'task') return;
      if (result.assignee) {
        if (
          !assignmentEdited &&
          draft.assignee === task.assignee &&
          JSON.stringify(draft.assignees) === originalPeople
        ) {
          draft.assignee = result.assignee;
          draft.assignees = [
            ...taskPeople({ assignee: result.assignee }, users),
            ...taskPeople(task, users).slice(1),
          ];
          assignmentMessage = `Tag automatisch zugeordnet: ${taskAssigneeNames({ assignee: result.assignee }, users)}. Bitte prüfen.`;
        } else
          assignmentMessage = `Der Tag passt zu ${taskAssigneeNames({ assignee: result.assignee }, users)}. Deine Eingabe bleibt erhalten.`;
      } else
        assignmentMessage = result.unavailable
          ? 'Die Personenzuordnung ist nicht verfügbar. Bitte die Zuständigkeit manuell prüfen.'
          : 'Der Tag lässt sich keinem Login eindeutig zuordnen. Bitte die Zuständigkeit prüfen.';
    } catch {
      if (sequence === assignmentRequest && dialog === 'task')
        assignmentMessage =
          'Die Personenzuordnung ist nicht verfügbar. Bitte die Zuständigkeit manuell prüfen.';
    } finally {
      if (sequence === assignmentRequest) assignmentLoading = false;
    }
  }
  /** Submit the active form and preserve its draft when validation or version checks fail. */
  async function save(): Promise<void> {
    if (assignmentLoading) return;
    busy = true;
    dialogError = null;
    fields = {};
    try {
      const etag = target?.etag;
      if (dialog === 'task') {
        const task = target && 'state' in target ? target : null;
        await sendApi(
          task?.state === 'vorschlag' || !task ? 'POST' : 'PUT',
          task?.state === 'vorschlag'
            ? `${endpoint}/${task.id}/entscheidung`
            : `${endpoint}${task ? `/${task.id}` : ''}`,
          {
            ...draft,
            assignee: taskAssigneeLogin(draft.assignee),
            etag,
            done: task?.state === 'erledigt',
            action: 'annehmen',
          }
        );
      } else if (dialog === 'project') {
        await sendApi(
          target ? 'PUT' : 'POST',
          `${endpoint}/projekte${target ? `/${target.id}` : ''}`,
          { title: draft.title, campflowId, etag }
        );
      } else if (dialog === 'template') {
        await sendApi(
          target ? 'PUT' : 'POST',
          `${endpoint}/vorlagen${target ? `/${target.id}` : ''}`,
          { title: draft.title, items, etag }
        );
      } else if (dialog === 'checklist') {
        const template = data?.templates.find((t) => t.id === templateId);
        const result = await sendApi<{ count: number }>('POST', `${endpoint}/checkliste`, {
          projectId: draft.projectId,
          templateId,
          date,
          etag: template?.etag,
        });
        message = result.count
          ? `${result.count} Aufgaben aus der Vorlage angelegt.`
          : 'Diese Vorlage wurde für das Projekt bereits angewendet.';
      }
      if (dialog !== 'checklist') message = 'Gespeichert.';
      dialog = null;
      await load();
    } catch (e) {
      dialogError = problem(e);
      fields = e instanceof ApiError ? (e.fields ?? {}) : {};
    } finally {
      busy = false;
    }
  }
  /** Apply a versioned task action, refresh the board and restore keyboard focus. */
  async function taskAction(task: Task, action: 'toggle' | 'reject' | 'delete'): Promise<void> {
    clearRecognition();
    if (busy) return;
    busy = true;
    error = null;
    message = null;
    try {
      if (action === 'toggle')
        await sendApi('PUT', `${endpoint}/${task.id}`, {
          ...task,
          done: task.state !== 'erledigt',
        });
      else if (action === 'reject')
        await sendApi('POST', `${endpoint}/${task.id}/entscheidung`, {
          etag: task.etag,
          action: 'ablehnen',
        });
      else await sendApi('DELETE', `${endpoint}/${task.id}`, undefined, { etag: task.etag });
      if (action === 'delete') deleteTarget = null;
      await load();
      busy = false;
      await tick();
      addButton?.focus();
      message =
        action === 'delete'
          ? 'Aufgabe gelöscht.'
          : action === 'reject'
            ? 'Vorschlag abgelehnt.'
            : 'Status gespeichert.';
    } catch (e) {
      if (action === 'delete') deleteError = problem(e);
      else error = problem(e);
    } finally {
      busy = false;
    }
  }
  /** Request explicitly reviewed protocol suggestions and refresh their source metadata. */
  async function recognize(): Promise<void> {
    if (!source) return;
    busy = true;
    error = null;
    message = null;
    clearRecognition();
    const sequence = recognitionRequest;
    try {
      const result = await sendApi<{ count: number; assignmentUnavailable?: boolean }>(
        'POST',
        `${endpoint}/protokolle/${encodeURIComponent(source.id)}/erkennen`,
        { etag: source.etag }
      );
      await load();
      await loadProtocols();
      if (sequence !== recognitionRequest) return;
      recognitionMessage = result.count
        ? `${result.count} neue Vorschläge erkannt. Bitte Fundstellen, Zuständigkeit und Fristen prüfen.`
        : 'Keine neuen Aufgabenvorschläge gefunden.';
      if (result.assignmentUnavailable)
        recognitionMessage +=
          ' Die Personenzuordnung ist nicht verfügbar; bitte Zuständigkeiten prüfen.';
    } catch (e) {
      if (sequence === recognitionRequest) recognitionError = problem(e);
      await loadProtocols();
    } finally {
      busy = false;
    }
  }
</script>

<StatusNotice
  message={error ?? message}
  kind={error ? 'error' : 'success'}
  class={error || message ? 'my-4' : ''}
  popup
/>
{#if loading && !data}<p role="status">Aufgaben werden geladen …</p>{/if}
{#if error}<ActionButton type="button" onclick={load} disabled={busy}>Neu laden</ActionButton>{/if}
{#if data}
  <div class="flex flex-wrap gap-2 mb-5">
    <ActionButton
      type="button"
      bind:element={addButton}
      variant="primary"
      onclick={() => open('task')}
      disabled={busy}>Aufgabe anlegen</ActionButton
    >
    <ActionButton
      type="button"
      variant="secondary"
      onclick={() => open('checklist')}
      disabled={busy || !data.projects.length || !data.templates.length}
      >Checkliste aus Vorlage</ActionButton
    >
  </div>
  <FilterTabs
    label="Aufgabenansicht"
    scrollable
    options={tabs}
    value={view}
    onselect={(value) => {
      view = value;
      clearRecognition();
      message = null;
    }}
  />
  {#if view === 'projekte'}
    <p class="my-3 text-neutral-700">Projekte bündeln Aufgaben für Aktionen und andere Vorhaben.</p>
    <ActionButton type="button" onclick={() => open('project')} disabled={busy}
      >Projekt anlegen</ActionButton
    >
    <ul class="mt-4 divide-y divide-neutral-200">
      {#each data.projects as project (project.id)}
        <li class="py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">{project.title}</h2>
            {#if project.campflowId}<a
                class="text-link"
                href="/leitendenbereich/aktionen/aktion?id={encodeURIComponent(project.campflowId)}"
                >CampFlow-Aktion öffnen</a
              >{/if}
          </div>
          <ActionButton
            type="button"
            variant="secondary"
            onclick={() => open('project', project)}
            disabled={busy}>Projekt bearbeiten</ActionButton
          >
        </li>
      {:else}<li class="py-4">
          Noch keine Projekte. Lege ein Projekt für eure nächste Aktion an.
        </li>{/each}
    </ul>
  {:else if view === 'vorlagen'}
    <p class="my-3 text-neutral-700">
      Vorlagen sind wiederverwendbar. Fristen beziehen sich auf das Datum der Aktion.
    </p>
    <ActionButton type="button" onclick={() => open('template')} disabled={busy}
      >Vorlage anlegen</ActionButton
    >
    <ul class="mt-4 divide-y divide-neutral-200">
      {#each data.templates as template (template.id)}
        <li class="py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">{template.title}</h2>
            <p>{template.items.length} Aufgaben</p>
          </div>
          <ActionButton
            type="button"
            variant="secondary"
            onclick={() => open('template', template)}
            disabled={busy}>Vorlage bearbeiten</ActionButton
          >
        </li>
      {:else}<li class="py-4">
          Noch keine Vorlagen. Lege eine Checkliste für wiederkehrende Aktionen an.
        </li>{/each}
    </ul>
  {:else}
    {#if view === 'vorschlag'}
      <section aria-labelledby="recognize-heading" class="my-5 surface-muted rounded-lg p-4">
        <h2 id="recognize-heading" class="text-lg font-semibold">Aufgaben aus Protokollen</h2>
        <p class="my-2 text-sm text-neutral-700">
          Reviewende können freigegebene oder archivierte Protokolle auswerten. Die KI schlägt nur
          vor; ihr prüft und übernehmt die Aufgaben einzeln.
        </p>
        <StatusNotice kind="error" message={protocolError} />
        <FormField id="task-protocol" label="Protokoll"
          >{#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={sourceId} onchange={clearRecognition}
              ><option value="">Bitte auswählen</option
              >{#each eligible as protocol (protocol.id)}<option value={protocol.id}
                  >{protocolLabel(protocol.date)} · {protocol.title}</option
                >{/each}</select
            >
          {/snippet}</FormField
        >
        {#if !data.extractionConfigured}<p class="my-2 text-sm">
            Die KI-Erkennung ist nicht eingerichtet. Aufgaben können manuell angelegt werden.
          </p>{/if}
        <ActionButton
          type="button"
          class="mt-3"
          onclick={recognize}
          disabled={busy || !source || !data?.reviewer || !data.extractionConfigured}
          aria-busy={busy}>{busy ? 'Wird verarbeitet …' : 'Aufgaben erkennen'}</ActionButton
        >
        <div role="status" aria-live="polite" aria-label="Erkennungsergebnis">
          {#if recognitionMessage || recognitionError}
            <div
              class="mt-4 flex items-start gap-3 rounded-md border border-neutral-300 bg-surface p-3"
            >
              <p class={recognitionError ? 'text-sm text-danger' : 'text-sm text-neutral-700'}>
                {recognitionError ?? recognitionMessage}
              </p>
              <button
                type="button"
                class="ml-auto min-h-11 min-w-11 shrink-0 text-neutral-700"
                aria-label="Erkennungsergebnis ausblenden"
                onclick={clearRecognition}>×</button
              >
            </div>
          {/if}
        </div>
      </section>
    {/if}
    <div
      role="group"
      aria-label="Aufgabenfilter"
      class="my-4 flex flex-wrap items-end gap-3 rounded-lg surface-muted p-3"
    >
      <FormField id="task-project-filter" label="Projekt"
        >{#snippet children(attrs)}
          <select
            {...attrs}
            class="form-input"
            bind:value={projectFilter}
            onchange={clearRecognition}
            ><option value="alle">Alle Projekte</option><option value="">Ohne Projekt</option
            >{#each data?.projects ?? [] as project (project.id)}<option value={String(project.id)}
                >{project.title}</option
              >{/each}</select
          >
        {/snippet}</FormField
      >
      <label
        class="flex items-center gap-3 min-h-11 cursor-pointer rounded-md border border-neutral-300 px-3 py-2"
        ><input
          type="checkbox"
          class="size-5 shrink-0"
          bind:checked={ownOnly}
          onchange={clearRecognition}
        /> Nur mir zugewiesen</label
      >
    </div>
    {#snippet taskRow(task: Task)}
      <li class={view === 'kanban' ? 'surface rounded-lg p-4' : 'py-4'} id="aufgabe-{task.id}">
        <svelte:element
          this={view === 'kanban' ? 'h3' : 'h2'}
          class="text-lg font-semibold break-words">{task.title}</svelte:element
        >
        {#if task.description}<p class="mt-1 whitespace-pre-wrap break-words">
            {task.description}
          </p>{/if}
        <p class="mt-2 text-sm text-neutral-700 break-words">
          {data?.projects.find((p) => p.id === task.projectId)?.title ?? 'Ohne Projekt'} · {taskAssigneeNames(
            task,
            users
          )} · {task.dueDate ? `Fällig: ${task.dueDate}` : 'Ohne Frist'}
        </p>
        {#if task.dueDate && task.dueDate < localDate() && task.state === 'offen'}<p
            class="text-warning"
          >
            Überfällig
          </p>{/if}
        {#if task.sourceId}
          <a
            class="text-link text-sm"
            href="/leitendenbereich/protokolle#protokoll-{encodeURIComponent(task.sourceId)}"
            >Quellprotokoll öffnen</a
          >
          <blockquote class="my-2 border-l-2 border-neutral-300 pl-3 text-sm break-words">
            {task.quote}
          </blockquote>
        {/if}
        <div class="mt-3 flex flex-wrap gap-2">
          {#if task.state === 'vorschlag'}
            <ActionButton
              type="button"
              disabled={busy || !data?.reviewer}
              onclick={() => review(task)}>Prüfen und annehmen</ActionButton
            >
            <ActionButton
              type="button"
              variant="secondary"
              disabled={busy || !data?.reviewer}
              onclick={() => taskAction(task, 'reject')}>Ablehnen</ActionButton
            >
          {:else}
            <ActionButton type="button" disabled={busy} onclick={() => taskAction(task, 'toggle')}
              >{task.state === 'erledigt' ? 'Wieder öffnen' : 'Erledigt'}</ActionButton
            >
            <ActionButton
              type="button"
              variant="secondary"
              disabled={busy}
              onclick={() => open('task', task)}>Bearbeiten</ActionButton
            >
            {#if !task.sourceId}<ActionButton
                type="button"
                variant="danger"
                disabled={busy}
                onclick={() => {
                  clearRecognition();
                  deleteError = null;
                  deleteTarget = task;
                }}>Löschen</ActionButton
              >{/if}
          {/if}
        </div>
      </li>
    {/snippet}
    {#if view === 'kanban'}
      <div class="grid min-w-0 gap-5 lg:grid-cols-3" aria-label="Kanban-Ansicht">
        {#each boardColumns as column (column.value)}
          {@const tasks = visible.filter((task) => task.state === column.value)}
          <section
            class="min-w-0 surface-muted rounded-lg p-3"
            aria-labelledby="kanban-{column.value}"
          >
            <h2 id="kanban-{column.value}" class="mb-3 text-lg font-semibold">
              {column.label}
              <span class="text-sm font-normal text-neutral-700">({tasks.length})</span>
            </h2>
            <ul class="space-y-3">
              {#each tasks as task (task.id)}
                {@render taskRow(task)}
              {:else}
                <li class="py-3 text-sm text-neutral-700">Keine Aufgaben für diese Auswahl.</li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {:else}
      <ul class="divide-y divide-neutral-200">
        {#each visible as task (task.id)}
          {@render taskRow(task)}
        {:else}<li class="py-3 text-neutral-700">
            Keine {view === 'vorschlag'
              ? 'Vorschläge'
              : view === 'erledigt'
                ? 'erledigten Aufgaben'
                : 'offenen Aufgaben'} für diese Auswahl.
            {#if view === 'vorschlag'}<p class="mt-1 text-sm">
                {data.extractionConfigured && data.reviewer
                  ? 'Wähle ein Protokoll und tippe auf Aufgaben erkennen.'
                  : 'Lege eine Aufgabe an oder prüfe die gewählten Filter.'}
              </p>{:else if view === 'offen'}<p class="mt-1 text-sm">
                Lege eine Aufgabe an oder ändere die Filter.
              </p>{/if}
          </li>{/each}
      </ul>
    {/if}
  {/if}
{/if}

<AufgabenDialog
  bind:dialog
  bind:draft
  bind:campflowId
  bind:items
  bind:templateId
  bind:date
  {target}
  {data}
  {busy}
  {dialogError}
  {assignmentLoading}
  {assignmentMessage}
  {users}
  {usersLoading}
  {usersUnavailable}
  {fields}
  onAssigneeEdit={() => (assignmentEdited = true)}
  onsubmit={save}
/>

<EditDialog
  open={deleteTarget !== null}
  title="Aufgabe löschen"
  {busy}
  error={deleteError}
  submitLabel="Löschen"
  submitVariant="danger"
  busyLabel="Wird gelöscht …"
  onclose={() => (deleteTarget = null)}
  onsubmit={() => {
    if (deleteTarget) {
      deleteError = null;
      void taskAction(deleteTarget, 'delete');
    }
  }}
>
  <p>Aufgabe „{deleteTarget?.title ?? ''}“ wirklich löschen?</p>
  <p class="text-sm text-neutral-700">Das Löschen kann nicht rückgängig gemacht werden.</p>
</EditDialog>
