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
  let {
    target = null,
    onclose,
    onsaved,
  }: { target?: Task | null; onclose: () => void; onsaved: (message: string) => void } = $props();
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
  const usersLoading = $derived(aufgabenStore.usersLoading);
  const usersUnavailable = $derived(aufgabenStore.usersUnavailable);
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
          assignmentMessage = `Zuordnungsvorschlag: ${taskAssigneeNames({ assignee: result.assignee }, users)}. Bitte prüfen.`;
        } else
          assignmentMessage = `Der Tag passt zu ${taskAssigneeNames({ assignee: result.assignee }, users)}. Deine Eingabe bleibt erhalten.`;
      } else
        assignmentMessage = result.unavailable
          ? 'Die Personenzuordnung ist nicht verfügbar. Bitte die Zuständigkeit manuell prüfen.'
          : 'Der Tag lässt sich keinem Login eindeutig zuordnen. Bitte die Zuständigkeit prüfen.';
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
        return 'Gespeichert.';
      },
      onsaved,
      !target || target.state === 'vorschlag'
    );
  }
</script>

<EditDialog
  open
  title={target?.state === 'vorschlag' ? 'Aufgabenvorschlag prüfen' : 'Aufgabe'}
  {busy}
  submitDisabled={assignmentLoading}
  error={form.state.error}
  onsubmit={save}
  {onclose}
  submitLabel={target?.state === 'vorschlag' ? 'Annehmen' : 'Speichern'}
>
  <div class="space-y-4">
    <FormField id="task-title" label="Titel" error={fields.title}
      >{#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          bind:value={draft.title}
          maxlength="200"
          required
        />{/snippet}</FormField
    >
    {#if target?.suggestedAssigneeName}
      <p class="text-sm text-neutral-700">
        Zuordnungsvorschlag: {target.suggestedAssigneeName} → {taskAssigneeNames(target, users)}.
        Bitte prüfen.
      </p>
    {/if}
    {#if target?.quote}<blockquote class="border-l-2 border-neutral-300 pl-3">
        {target.quote}
      </blockquote>{/if}
    <FormField id="task-description" label="Beschreibung" optional error={fields.description}
      >{#snippet children(attrs)}<textarea
          {...attrs}
          class="form-input"
          bind:value={draft.description}
          maxlength="2000"></textarea>{/snippet}</FormField
    >
    <TaskAssigneeField
      id="task-assignee"
      bind:people={draft.assignees}
      {users}
      loading={usersLoading}
      unavailable={usersUnavailable}
      error={fields.assignee}
      onedit={() => (assignmentEdited = true)}
    />
    {#if assignmentLoading}<p role="status" class="text-sm text-neutral-700">
        Name wird einem Login zugeordnet …
      </p>{:else if assignmentMessage}<p role="status" class="text-sm text-neutral-700">
        {assignmentMessage}
      </p>{/if}
    <FormField id="task-due" label="Fälligkeit" optional error={fields.dueDate}
      >{#snippet children(attrs)}<GermanDateInput
          {...attrs}
          value={draft.dueDate ?? ''}
          onchange={(value) => (draft.dueDate = value || null)}
        />{/snippet}</FormField
    >
    <details class="text-xs text-neutral-700">
      <summary class="min-h-11 cursor-pointer py-2">Erinnerungen zur Frist</summary>
      <p>
        Am Vortag und Fälligkeitstag erhalten Zuständige mit Stammes-Login ab 9 Uhr eine Sammelmail.
      </p>
    </details>
    <FormField id="task-project" label="Projekt" optional error={fields.projectId}
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
    {#if target && target.state === 'vorschlag' && target.suggestedProjectTitle}
      <fieldset class="surface-muted rounded-sm p-3 space-y-3">
        <legend class="font-semibold">Projektvorschlag</legend>
        <p class="text-sm text-neutral-700">
          Vorgeschlagen: {target.suggestedProjectTitle}. Das Projekt wird erst beim Annehmen dieser
          Aufgabe angelegt. Ein inzwischen vorhandenes Projekt mit gleichem Namen wird verwendet.
        </p>
        <label class="flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" class="size-5" bind:checked={createSuggestedProject} />
          Neues Projekt anlegen und Aufgabe zuordnen
        </label>
        {#if createSuggestedProject}
          <FormField
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
    {/if}
  </div>
</EditDialog>
