<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { SvelteDate } from 'svelte/reactivity';
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
  import StatusNotice from './pflege/StatusNotice.svelte';
  import AufgabenDialog from './AufgabenDialog.svelte';
  import AufgabenKarte from './AufgabenKarte.svelte';
  import EditDialog from './pflege/EditDialog.svelte';
  import Toast from './ui/Toast.svelte';
  import SegmentedControl from './ui/SegmentedControl.svelte';
  import FormField from './pflege/FormField.svelte';

  interface Props {
    area?: 'aufgaben' | 'projekte' | 'vorlagen' | 'vorschlag';
  }
  let { area = 'aufgaben' }: Props = $props();
  let presentation = $state('liste');
  let statusFilter = $state('alle');
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
  const view = $derived(
    area === 'aufgaben' ? (presentation === 'kanban' ? 'kanban' : statusFilter) : area
  );
  let projectFilter = $state('alle');
  let ownOnly = $state(false);
  let filtersOpen = $state(false);
  const activeFilters = $derived(Number(projectFilter !== 'alle') + Number(ownOnly));
  let sourceId = $state('');
  let addButton = $state<HTMLButtonElement | null>(null);
  let dialog = $state<'task' | 'project' | 'template' | 'checklist' | null>(null);
  let target = $state<Task | TaskProject | TaskTemplate | null>(null);
  let dialogError = $state<string | null>(null);
  let menuTarget = $state<Task | null>(null);
  let undoTask = $state<Task | null>(null);
  let completionNotice = $state<string | null>(null);
  let deleteTarget = $state<Task | null>(null);
  let deleteProjectTarget = $state<TaskProject | null>(null);
  let createSuggestedProject = $state(false);
  let proposedProjectTitle = $state('');
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
  const statusOptions = $derived(
    ['alle', 'offen', 'erledigt'].map((value) => ({
      value,
      label: value === 'alle' ? 'Alle' : value === 'offen' ? 'Offen' : 'Erledigt',
      count: (data?.tasks ?? []).filter(
        (task) =>
          ['offen', 'erledigt'].includes(task.state) &&
          (value === 'alle' || task.state === value) &&
          (projectFilter === 'alle' || String(task.projectId ?? '') === projectFilter) &&
          (!ownOnly || taskHasAssignee(task, data?.login))
      ).length,
    }))
  );
  const administration = $derived([
    {
      path: 'vorschlaege',
      value: 'vorschlag',
      label: 'Vorschläge',
      description: 'Aufgaben aus Protokollen prüfen',
      count: (data?.tasks ?? []).filter(
        (task) =>
          task.state === 'vorschlag' &&
          (!task.dueDate || task.dueDate >= proposalDay.format(new Date()))
      ).length,
    },
    {
      path: 'projekte',
      value: 'projekte',
      label: 'Projekte',
      description: 'Vorhaben und ihre Aufgaben verwalten',
      count: data?.projects.length ?? 0,
    },
    {
      path: 'vorlagen',
      value: 'vorlagen',
      label: 'Vorlagen',
      description: 'Wiederverwendbare Checklisten verwalten',
      count: data?.templates.length ?? 0,
    },
  ]);
  function dueLabel(task: Task): string {
    if (!task.dueDate) return 'Ohne Frist';
    const today = proposalDay.format(new Date());
    if (task.state === 'offen' && task.dueDate < today) {
      const days = Math.round(
        (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${task.dueDate}T12:00:00Z`)) / 86400000
      );
      return `Fällig: ${days} ${days === 1 ? 'Tag' : 'Tage'} überfällig`;
    }
    const tomorrow = new SvelteDate(`${today}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const label =
      task.dueDate === today
        ? 'Heute'
        : task.dueDate === tomorrow.toISOString().slice(0, 10)
          ? 'Morgen'
          : new Intl.DateTimeFormat('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(`${task.dueDate}T12:00:00Z`));
    return `Fällig: ${label}`;
  }
  function dueSoon(task: Task): boolean {
    if (task.state !== 'offen' || !task.dueDate) return false;
    const today = proposalDay.format(new Date());
    const horizon = new SvelteDate(`${today}T12:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + 3);
    return task.dueDate <= horizon.toISOString().slice(0, 10);
  }
  const boardColumns = [
    { value: 'offen', label: 'Offen' },
    { value: 'erledigt', label: 'Erledigt' },
  ];
  const visible = $derived(
    (data?.tasks ?? [])
      .filter(
        (task) =>
          (area === 'aufgaben'
            ? ['offen', 'erledigt'].includes(task.state) &&
              (statusFilter === 'alle' || task.state === statusFilter)
            : task.state === 'vorschlag') &&
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
  function selectPresentation(value: string): void {
    presentation = value;
    message = null;
    try {
      localStorage.setItem('phoenix-task-presentation', value);
    } catch {
      /* Storage can be unavailable. */
    }
  }
  onMount(() => {
    try {
      const saved = localStorage.getItem('phoenix-task-presentation');
      if (saved === 'liste' || saved === 'kanban') presentation = saved;
    } catch {
      /* Keep the default view. */
    }
    void loadUsers();
    sourceId = new URLSearchParams(location.search).get('protokoll') ?? '';
    if (sourceId && area === 'aufgaben') {
      location.replace(`/leitendenbereich/aufgaben/vorschlaege${location.search}`);
      return;
    }
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
      open('project');
      campflowId = action;
      draft.title = campflowEventsStore.data?.find((e) => e.id === action)?.title ?? '';
    });
    if (area === 'vorschlag') void loadProtocols();
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
        description: entry.description || (entry.state === 'vorschlag' ? entry.quote : ''),
        assignee: entry.assignee,
        assignees: taskPeople(entry, users),
        dueDate: entry.dueDate,
        projectId: entry.projectId,
      };
    createSuggestedProject = false;
    proposedProjectTitle = entry && 'state' in entry ? (entry.suggestedProjectTitle ?? '') : '';
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
            newProjectTitle:
              task?.state === 'vorschlag' && createSuggestedProject
                ? proposedProjectTitle
                : undefined,
            projectId: createSuggestedProject ? null : draft.projectId,
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
          ? `${result.count} ${result.count === 1 ? 'Aufgabe' : 'Aufgaben'} aus der Vorlage angelegt.`
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
  async function taskAction(
    task: Task,
    action: 'toggle' | 'reject' | 'delete',
    restoring = false
  ): Promise<void> {
    clearRecognition();
    if (busy) return;
    undoTask = null;
    completionNotice = null;
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
      if (action === 'toggle') {
        undoTask = restoring ? null : (data?.tasks.find((item) => item.id === task.id) ?? null);
        completionNotice = restoring
          ? 'Änderung rückgängig gemacht.'
          : task.state === 'erledigt'
            ? 'Aufgabe wieder geöffnet.'
            : 'Aufgabe erledigt.';
      }
      message =
        action === 'delete'
          ? 'Aufgabe gelöscht.'
          : action === 'reject'
            ? 'Vorschlag abgelehnt.'
            : null;
    } catch (e) {
      if (action === 'delete') deleteError = problem(e);
      else error = problem(e);
    } finally {
      busy = false;
    }
  }
  async function removeProject(): Promise<void> {
    if (!deleteProjectTarget || busy) return;
    const project = deleteProjectTarget;
    busy = true;
    deleteError = null;
    message = null;
    try {
      await sendApi('DELETE', `${endpoint}/projekte/${project.id}`, undefined, {
        etag: project.etag,
      });
      deleteProjectTarget = null;
      if (projectFilter === String(project.id)) projectFilter = 'alle';
      await load();
      message = 'Projekt gelöscht. Zugehörige Aufgaben bleiben erhalten.';
      busy = false;
      await tick();
      addButton?.focus();
    } catch (e) {
      deleteError = problem(e);
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
        ? `${result.count} ${result.count === 1 ? 'neuer Vorschlag' : 'neue Vorschläge'} erkannt. Bitte Fundstellen, Zuständigkeit und Fristen prüfen.`
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
  {#if area === 'aufgaben'}
    {@const pending = administration.find((item) => item.value === 'vorschlag')?.count ?? 0}
    {#if pending > 0}<a
        href="/leitendenbereich/aufgaben/vorschlaege"
        data-astro-reload
        class="mb-3 inline-flex min-h-11 items-center gap-2 text-link"
        ><span
          class="rounded-full bg-[var(--color-warning-soft)] px-2 py-0.5 text-sm font-semibold text-warning"
          >{pending}</span
        >{pending === 1 ? 'Aufgabenvorschlag prüfen' : 'Aufgabenvorschläge prüfen'}</a
      >{/if}
    <div class="flex flex-wrap gap-2 mb-3">
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
    <div class="mb-3 grid gap-2 sm:flex sm:flex-wrap sm:gap-3">
      <SegmentedControl
        label="Darstellung"
        options={[
          { value: 'liste', label: 'Liste' },
          { value: 'kanban', label: 'Kanban' },
        ]}
        value={presentation}
        onselect={selectPresentation}
      />
      <SegmentedControl
        label="Status"
        options={statusOptions}
        value={statusFilter}
        onselect={(value) => {
          statusFilter = value;
          message = null;
        }}
      />
    </div>
  {:else}
    <a
      class="inline-flex min-h-11 items-center text-link"
      href="/leitendenbereich/aufgaben"
      data-astro-reload>Zur Aufgabenliste</a
    >
  {/if}
  {#if view === 'projekte'}
    <p class="my-3 text-neutral-700">Projekte bündeln Aufgaben für Aktionen und andere Vorhaben.</p>
    <ActionButton type="button" onclick={() => open('project')} disabled={busy}
      >Projekt anlegen</ActionButton
    >
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
              onclick={() => open('project', project)}
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
            <p>{template.items.length} {template.items.length === 1 ? 'Aufgabe' : 'Aufgaben'}</p>
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
        {#if !source && data.reviewer && data.extractionConfigured}<p
            class="mt-2 text-sm text-neutral-700"
          >
            Wähle zuerst ein Protokoll.
          </p>{:else if !data.reviewer}<p class="mt-2 text-sm text-neutral-700">
            Die Erkennung ist nur für Reviewende verfügbar.
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
    <details bind:open={filtersOpen} class="my-3">
      <summary class="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand-900"
        >Filter ({activeFilters} aktiv)</summary
      >
      <div role="group" aria-label="Aufgabenfilter" class="my-3 flex flex-wrap items-end gap-3">
        <FormField id="task-project-filter" label="Projekt"
          >{#snippet children(attrs)}
            <select
              {...attrs}
              class="form-input"
              bind:value={projectFilter}
              onchange={clearRecognition}
              ><option value="alle">Alle Projekte</option><option value="">Ohne Projekt</option
              >{#each data?.projects ?? [] as project (project.id)}<option
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
            onchange={clearRecognition}
          /> Nur mir zugewiesen</label
        >
      </div>
    </details>
    {#snippet taskRow(task: Task)}
      <AufgabenKarte
        {task}
        project={data?.projects.find((p) => p.id === task.projectId)?.title ??
          (task.state === 'vorschlag' && task.suggestedProjectTitle
            ? `Projektvorschlag: ${task.suggestedProjectTitle}`
            : 'Ohne Projekt')}
        people={taskAssigneeNames(task, users)}
        deadline={dueLabel(task)}
        urgent={dueSoon(task)}
        kanban={view === 'kanban'}
        {busy}
        reviewer={data?.reviewer ?? false}
        onopen={() => open('task', task)}
        ontoggle={() => taskAction(task, 'toggle')}
        onreview={() => review(task)}
        onreject={() => taskAction(task, 'reject')}
        onmenu={() => {
          menuTarget = task;
        }}
      />
    {/snippet}
    {#if view === 'kanban'}
      <div
        class="grid min-w-0 gap-5 {statusFilter === 'alle' ? 'lg:grid-cols-2' : ''}"
        aria-label="Kanban-Ansicht"
      >
        {#each boardColumns.filter((column) => statusFilter === 'alle' || column.value === statusFilter) as column (column.value)}
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
                <li class="py-3 text-sm text-neutral-700">
                  {projectFilter !== 'alle' || ownOnly || statusFilter !== 'alle'
                    ? 'Keine passenden Aufgaben. Passe die Filter an.'
                    : column.value === 'offen'
                      ? 'Noch keine offenen Aufgaben. Lege eine Aufgabe an.'
                      : 'Noch nichts erledigt. Markiere fertige Aufgaben als erledigt.'}
                </li>
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
                : view === 'alle'
                  ? 'Aufgaben'
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
  <!-- Each area gets a fresh task island so old dialogs cannot survive a page transition. -->
  <nav aria-label="Planung und Verwaltung" class="mt-8 border-t border-neutral-200 pt-5">
    <h2 class="mb-3 text-lg font-semibold">Planung und Verwaltung</h2>
    <div class="grid gap-3 sm:grid-cols-3">
      {#each administration as item (item.value)}
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
{/if}

<AufgabenDialog
  bind:dialog
  bind:createSuggestedProject
  bind:proposedProjectTitle
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

<Toast
  message={completionNotice}
  actionLabel={undoTask ? 'Rückgängig' : undefined}
  onaction={() => {
    if (undoTask) void taskAction(undoTask, 'toggle', true);
  }}
  onclose={() => {
    completionNotice = null;
    undoTask = null;
  }}
  duration={10000}
/>

<EditDialog
  open={menuTarget !== null}
  title="Aufgabenaktionen"
  mobileSheet
  hideSubmit
  cancelLabel="Schließen"
  {busy}
  onsubmit={() => {}}
  onclose={() => (menuTarget = null)}
>
  <p class="font-semibold break-words">{menuTarget?.title}</p>
  <div class="mt-3 grid gap-3">
    <ActionButton
      type="button"
      variant="secondary"
      onclick={async () => {
        const task = menuTarget;
        menuTarget = null;
        await tick();
        if (task) open('task', task);
      }}>Bearbeiten</ActionButton
    >
    {#if menuTarget && !menuTarget.sourceId}<ActionButton
        type="button"
        variant="danger"
        onclick={async () => {
          const task = menuTarget;
          menuTarget = null;
          await tick();
          clearRecognition();
          deleteError = null;
          deleteTarget = task;
        }}>Löschen</ActionButton
      >{/if}
  </div>
</EditDialog>

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

<EditDialog
  open={deleteProjectTarget !== null}
  title="Projekt löschen"
  {busy}
  error={deleteError}
  submitLabel="Projekt löschen"
  submitVariant="danger"
  busyLabel="Wird gelöscht …"
  onclose={() => (deleteProjectTarget = null)}
  onsubmit={removeProject}
>
  <p>Projekt „{deleteProjectTarget?.title ?? ''}“ wirklich löschen?</p>
  <p class="text-sm text-neutral-700">
    Die Aufgaben bleiben erhalten und werden „Ohne Projekt“ angezeigt. Vorlagen und die verknüpfte
    CampFlow-Aktion bleiben erhalten.
  </p>
</EditDialog>

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
