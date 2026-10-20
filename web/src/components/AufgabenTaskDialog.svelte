<script lang="ts">
  import { untrack } from 'svelte';
  import { sendApi } from '../lib/api';
  import { aufgabenStore, applyTask, TASK_ENDPOINT } from '../lib/aufgabenStore.svelte';
  import { createTaskForm } from '../lib/aufgabenForm.svelte';
  import EditDialog from './pflege/EditDialog.svelte';
  import FormField from './pflege/FormField.svelte';
  import { onMount } from 'svelte';
  import type { Task, TaskInput, TaskAssignment } from '../lib/types';
  import { taskPeople, taskAssigneeNames } from '../../../api/lib/aufgaben-zuordnung';
  import TaskAssigneeField from './TaskAssigneeField.svelte';
  import GermanDateInput from './ui/GermanDateInput.svelte';
  import { rescuePeople } from '../lib/taskRescue';
  let {
    target: initialTarget = null,
    onclose,
    onsaved,
  }: { target?: Task | null; onclose: () => void; onsaved: (message: string) => void } = $props();
  // The dialog owns its current version; reloading never overwrites a parent prop.
  let target = $state(untrack(() => initialTarget));
  let draft = $state<Omit<TaskInput, 'assignee'>>(
    untrack(() => ({
      title: target?.title ?? '',
      description:
        target?.state === 'vorschlag' && !target.description.trim()
          ? target.quote
          : (target?.description ?? ''),
      assignees: target ? taskPeople(target, aufgabenStore.users) : [],
      dueDate: target?.dueDate ?? null,
      projectId: target?.projectId ?? null,
    }))
  );
  let createSuggestedProject = $state(false);
  let proposedProjectTitle = $state(untrack(() => target?.suggestedProjectTitle ?? ''));
  const form = createTaskForm();
  const fields = $derived(form.state.fields);
  const busy = $derived(form.state.busy);
  const data = $derived(aufgabenStore.data);
  const users = $derived(aufgabenStore.users);
  let assignmentRequest = 0;
  let assignmentEdited = false;
  let assignmentLoading = $state(false);
  let assignmentMessage = $state<string | null>(null);
  onMount(() => {
    if (target?.state === 'vorschlag') void assign(target);
    return () => {
      assignmentRequest++;
    };
  });
  async function assign(task: Task): Promise<void> {
    if (task.assignmentResolution === 'declined') {
      assignmentMessage =
        'Die automatische Zuordnung hat keine eindeutige Person gefunden. Bitte wähle bei Bedarf selbst eine Person.';
      return;
    }
    if (!task.assignee || task.assignees?.some((person) => person.login)) return;
    const sequence = ++assignmentRequest;
    const originalPeople = JSON.stringify(draft.assignees);
    assignmentLoading = true;
    try {
      const result = await sendApi<TaskAssignment>(
        'POST',
        `${TASK_ENDPOINT}/${task.id}/zuordnung`,
        {
          etag: task.etag,
        }
      );
      if (sequence !== assignmentRequest) return;
      if (result.assignee) {
        if (!assignmentEdited && JSON.stringify(draft.assignees) === originalPeople) {
          draft.assignees = [
            ...taskPeople({ assignee: result.assignee }, users),
            ...taskPeople(task, users).slice(1),
          ];
          assignmentMessage = null;
        } else
          assignmentMessage = `Die Zuständigkeit passt zu ${taskAssigneeNames({ assignee: result.assignee }, users)}. Deine Eingabe bleibt erhalten.`;
      } else
        assignmentMessage = result.unavailable
          ? 'Die Personenzuordnung ist nicht verfügbar. Bitte die Zuständigkeit manuell prüfen.'
          : 'Der Name lässt sich keiner Person eindeutig zuordnen. Bitte die Zuständigkeit prüfen.';
    } catch {
      if (sequence === assignmentRequest)
        assignmentMessage =
          'Die Personenzuordnung ist nicht verfügbar. Bitte die Zuständigkeit manuell prüfen.';
    } finally {
      if (sequence === assignmentRequest) assignmentLoading = false;
    }
  }
  async function save(): Promise<void> {
    if (assignmentLoading) return;
    await form.submit(
      async () => {
        const updated = await sendApi<Task>(
          target?.state === 'vorschlag' || !target ? 'POST' : 'PUT',
          target?.state === 'vorschlag'
            ? `${TASK_ENDPOINT}/${target.id}/entscheidung`
            : `${TASK_ENDPOINT}${target ? `/${target.id}` : ''}`,
          {
            ...draft,
            assignee: draft.assignees?.[0]?.login || draft.assignees?.[0]?.name || '',
            etag: target?.etag,
            done: target?.state === 'erledigt',
            action: 'annehmen',
            newProjectTitle:
              target?.state === 'vorschlag' && createSuggestedProject
                ? proposedProjectTitle
                : undefined,
            projectId: createSuggestedProject ? null : draft.projectId,
          }
        );
        if (target && target.state !== 'vorschlag') applyTask(updated);
        return target?.state === 'vorschlag'
          ? createSuggestedProject
            ? 'Aufgabe angenommen und dem bestätigten Projekt zugeordnet.'
            : 'Aufgabe angenommen.'
          : target
            ? 'Aufgabe gespeichert.'
            : 'Aufgabe angelegt.';
      },
      onsaved,
      !target || target.state === 'vorschlag'
    );
  }
  async function reload(): Promise<boolean> {
    return form.reload(() => {
      const fresh = aufgabenStore.data?.tasks.find((item) => item.id === target?.id);
      if (!fresh || !['offen', 'erledigt', 'vorschlag'].includes(fresh.state)) {
        onclose();
        return;
      }
      assignmentRequest++;
      assignmentLoading = false;
      target = fresh;
      draft = {
        title: fresh.title,
        description: fresh.description || (fresh.state === 'vorschlag' ? fresh.quote : ''),
        assignees: taskPeople(fresh, users),
        dueDate: fresh.dueDate,
        projectId: fresh.projectId,
      };
      createSuggestedProject = false;
      proposedProjectTitle = fresh.suggestedProjectTitle ?? '';
    });
  }
</script>

<EditDialog
  open
  title={target?.state === 'vorschlag'
    ? 'Aufgabenvorschlag prüfen'
    : target
      ? 'Aufgabe bearbeiten'
      : 'Aufgabe anlegen'}
  rescueKey={`aufgabe:${target?.id ?? 'neu'}`}
  rescueVersion={target?.etag}
  rescueFields={[
    rescuePeople(
      'Zuständige',
      () => draft.assignees,
      (people) => {
        draft.assignees = people;
        assignmentEdited = true;
      }
    ),
  ]}
  {busy}
  submitDisabled={assignmentLoading}
  error={form.state.error}
  onedit={form.changed}
  onreload={form.state.conflict ? reload : undefined}
  onsubmit={save}
  {onclose}
  submitLabel={target?.state === 'vorschlag' ? 'Annehmen' : 'Speichern'}
>
  <div class="space-y-4">
    {#if target?.state === 'vorschlag'}<p class="text-sm text-neutral-700">
        Mit „Annehmen“ wird der Vorschlag zu einer offenen Aufgabe. Nur Zuständige mit hinterlegter
        Stammes-E-Mail-Adresse (@stamm-phoenix.de) erhalten bei einer Frist Erinnerungen.
      </p>{/if}
    <FormField name="title" id="task-title" label="Titel" error={fields.title}
      >{#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          bind:value={draft.title}
          maxlength="200"
          required
        />{/snippet}</FormField
    >
    {#if target?.state === 'vorschlag' && draft.assignees?.some((person) => person.login)}
      <p class="text-sm text-neutral-700">
        Zuordnungsvorschlag: {target.suggestedAssigneeName || target.assignee} → {taskAssigneeNames(
          { assignee: '', assignees: draft.assignees },
          users
        )}. Bitte prüfen.
      </p>
    {/if}
    {#if target?.quote}<blockquote class="border-l-2 border-neutral-300 pl-3">
        {target.quote}
      </blockquote>{/if}
    <FormField
      name="description"
      id="task-description"
      label="Beschreibung"
      optional
      error={fields.description}
      >{#snippet children(attrs)}<textarea
          {...attrs}
          class="form-input"
          bind:value={draft.description}
          maxlength="2000"></textarea>{/snippet}</FormField
    >
    <TaskAssigneeField
      id="task-assignee"
      bind:people={draft.assignees}
      error={fields.assignee}
      onedit={() => {
        assignmentEdited = true;
        form.clearField('assignee');
      }}
    />
    {#if assignmentLoading}<p role="status" class="text-sm text-neutral-700">
        Passende Person wird gesucht …
      </p>{:else if assignmentMessage}<p role="status" class="text-sm text-neutral-700">
        {assignmentMessage}
      </p>{/if}
    <FormField name="dueDate" id="task-due" label="Fälligkeit" optional error={fields.dueDate}
      >{#snippet children(attrs)}<GermanDateInput
          {...attrs}
          value={draft.dueDate ?? ''}
          onchange={(value) => (draft.dueDate = value || null)}
        />{/snippet}</FormField
    >
    <p class="text-sm text-neutral-700">
      Nur Zuständige mit einer hinterlegten Stammes-E-Mail-Adresse (@stamm-phoenix.de) bekommen am
      Vortag und am Fälligkeitstag ab 9 Uhr eine Erinnerungsmail.
    </p>
    <FormField name="projectId" id="task-project" label="Projekt" optional error={fields.projectId}
      >{#snippet children(attrs)}
        <select
          {...attrs}
          class="form-input"
          bind:value={draft.projectId}
          disabled={createSuggestedProject}
          ><option value={null}>Ohne Projekt</option
          >{#each data?.projects ?? [] as project (project.id)}<option value={project.id}
              >{project.title}</option
            >{/each}</select
        >
      {/snippet}</FormField
    >
    {#if target?.state === 'vorschlag'}{#if target?.suggestedProjectTitle}
        <fieldset class="surface-muted rounded-sm p-3 space-y-3">
          <legend class="font-semibold">Projektvorschlag</legend>
          <p class="text-sm text-neutral-700">
            Vorgeschlagen: {target?.suggestedProjectTitle}. Das Projekt wird erst beim Annehmen
            dieser Aufgabe angelegt. Ein inzwischen vorhandenes Projekt mit gleichem Namen wird
            verwendet.
          </p>
          <label class="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              name="newProjectTitle"
              type="checkbox"
              class="size-5"
              bind:checked={createSuggestedProject}
            />
            Neues Projekt anlegen und Aufgabe zuordnen
          </label>
          {#if createSuggestedProject}
            <FormField
              name="newProjectTitle"
              id="suggested-project-title"
              label="Name des neuen Projekts"
              error={fields.newProjectTitle}
            >
              {#snippet children(attrs)}<input
                  {...attrs}
                  class="form-input"
                  bind:value={proposedProjectTitle}
                  maxlength="200"
                  required
                />{/snippet}
            </FormField>
          {/if}
        </fieldset>
      {/if}{/if}
  </div>
</EditDialog>
