<script lang="ts">
  import type { SharePointSiteUser } from '../../../api/lib/aufgaben-zuordnung';
  import type {
    Task,
    TaskInput,
    TaskProject,
    TaskTemplate,
    TemplateItem,
    TasksOverview,
  } from '../lib/types';
  import { campflowEventsStore } from '../lib/campflowStore.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';
  import EditDialog from './pflege/EditDialog.svelte';
  import FormField from './pflege/FormField.svelte';
  import GermanDateInput from './ui/GermanDateInput.svelte';
  import TaskAssigneeField from './TaskAssigneeField.svelte';

  interface Props {
    dialog: 'task' | 'project' | 'template' | 'checklist' | null;
    draft: TaskInput;
    createSuggestedProject: boolean;
    proposedProjectTitle: string;
    campflowId: string;
    items: TemplateItem[];
    templateId: number | null;
    date: string;
    target: Task | TaskProject | TaskTemplate | null;
    data: TasksOverview | null;
    busy: boolean;
    dialogError: string | null;
    assignmentLoading: boolean;
    assignmentMessage: string | null;
    users: SharePointSiteUser[];
    usersLoading: boolean;
    usersUnavailable: boolean;
    fields: Record<string, string>;
    onsubmit: () => void;
    onAssigneeEdit: () => void;
  }
  let {
    dialog = $bindable(),
    draft = $bindable(),
    createSuggestedProject = $bindable(),
    proposedProjectTitle = $bindable(),
    campflowId = $bindable(),
    items = $bindable(),
    templateId = $bindable(),
    date = $bindable(),
    target,
    data,
    busy,
    dialogError,
    assignmentLoading,
    assignmentMessage,
    users,
    usersLoading,
    usersUnavailable,
    fields,
    onsubmit,
    onAssigneeEdit,
  }: Props = $props();
  function eventProject(): void {
    const event = campflowEventsStore.data?.find((e) => e.id === campflowId);
    if (event && !draft.title) draft.title = event.title;
  }
</script>

<EditDialog
  open={dialog !== null}
  title={dialog === 'task'
    ? target && 'state' in target && target.state === 'vorschlag'
      ? 'Aufgabenvorschlag prüfen'
      : 'Aufgabe'
    : dialog === 'project'
      ? 'Projekt'
      : dialog === 'template'
        ? 'Vorlage'
        : 'Checkliste aus Vorlage'}
  {busy}
  submitDisabled={assignmentLoading}
  error={dialogError}
  {onsubmit}
  onclose={() => (dialog = null)}
  submitLabel={target && 'state' in target && target.state === 'vorschlag'
    ? 'Annehmen'
    : 'Speichern'}
>
  <div class="space-y-4">
    {#if dialog !== 'checklist'}
      <FormField id="task-title" label="Titel" error={fields.title}
        >{#snippet children(attrs)}<input
            {...attrs}
            class="form-input"
            bind:value={draft.title}
            maxlength="200"
            required
          />{/snippet}</FormField
      >
    {/if}
    {#if dialog === 'task'}
      {#if target && 'quote' in target && target.quote}<blockquote
          class="border-l-2 border-neutral-300 pl-3"
        >
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
        bind:value={draft.assignee}
        bind:people={draft.assignees}
        {users}
        loading={usersLoading}
        unavailable={usersUnavailable}
        error={fields.assignee}
        onedit={onAssigneeEdit}
      />
      {#if assignmentLoading}<p role="status" class="text-sm text-neutral-700">
          Tag wird einem Login zugeordnet …
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
          Am Vortag und Fälligkeitstag erhalten Zuständige mit Stammes-Login ab 9 Uhr eine
          Sammelmail.
        </p>
      </details>
    {/if}
    {#if dialog === 'task' || dialog === 'checklist'}
      <FormField
        id="task-project"
        label="Projekt"
        optional={dialog === 'task'}
        error={fields.projectId}
        >{#snippet children(attrs)}
          <select
            {...attrs}
            class="form-input"
            bind:value={draft.projectId}
            required={dialog === 'checklist'}
            disabled={createSuggestedProject}
            ><option value={null}>{dialog === 'task' ? 'Ohne Projekt' : 'Bitte auswählen'}</option
            >{#each data?.projects ?? [] as project (project.id)}<option value={project.id}
                >{project.title}</option
              >{/each}</select
          >
        {/snippet}</FormField
      >
    {/if}
    {#if dialog === 'task' && target && 'state' in target && target.state === 'vorschlag' && target.suggestedProjectTitle}
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
    {#if dialog === 'project'}
      <FormField id="project-event" label="CampFlow-Aktion" optional error={fields.campflowId}
        >{#snippet children(attrs)}
          <select {...attrs} class="form-input" bind:value={campflowId} onchange={eventProject}
            ><option value="">Eigenständiges Projekt</option
            >{#if campflowId && !campflowEventsStore.data?.some((e) => e.id === campflowId)}<option
                value={campflowId}>Verknüpfte Aktion</option
              >{/if}{#each campflowEventsStore.data ?? [] as event (event.id)}<option
                value={event.id}>{event.title}</option
              >{/each}</select
          >
        {/snippet}</FormField
      >
      <StatusNotice kind="error" message={campflowEventsStore.error} />
    {/if}
    {#if dialog === 'template'}
      <p class="text-sm text-neutral-700">
        Positive Tageszahlen liegen vor der Aktion; negative danach.
      </p>
      {#each items as item, index (item)}
        <fieldset class="border-t border-neutral-200 pt-3 space-y-3">
          <legend class="font-semibold">Aufgabe {index + 1}</legend>
          <FormField id="template-title-{index}" label="Aufgabentitel"
            >{#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                bind:value={item.title}
                required
                maxlength="200"
              />{/snippet}</FormField
          >
          <FormField id="template-description-{index}" label="Beschreibung" optional
            >{#snippet children(attrs)}<textarea
                {...attrs}
                class="form-input"
                bind:value={item.description}
                maxlength="2000"></textarea>{/snippet}</FormField
          >
          <TaskAssigneeField
            id="template-assignee-{index}"
            bind:value={item.assignee}
            bind:people={item.assignees}
            {users}
            loading={usersLoading}
            unavailable={usersUnavailable}
          />
          <FormField id="template-days-{index}" label="Tage vor der Aktion"
            >{#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                type="number"
                min="-366"
                max="366"
                step="1"
                bind:value={item.daysBefore}
                required
              />{/snippet}</FormField
          >
          <ActionButton
            type="button"
            variant="secondary"
            disabled={items.length === 1 || busy}
            onclick={() => (items = items.filter((_, i) => i !== index))}
            >Vorlagenaufgabe entfernen</ActionButton
          >
        </fieldset>
      {/each}
      <StatusNotice kind="error" message={fields.items ?? null} />
      <ActionButton
        type="button"
        variant="secondary"
        disabled={items.length >= 50 || busy}
        onclick={() =>
          (items = [...items, { title: '', description: '', assignee: '', daysBefore: 0 }])}
        >Vorlagenaufgabe hinzufügen</ActionButton
      >
    {/if}
    {#if dialog === 'checklist'}
      <FormField id="checklist-template" label="Vorlage" error={fields.templateId}
        >{#snippet children(attrs)}<select
            {...attrs}
            class="form-input"
            bind:value={templateId}
            required
            ><option value={null}>Bitte auswählen</option
            >{#each data?.templates ?? [] as template (template.id)}<option value={template.id}
                >{template.title}</option
              >{/each}</select
          >{/snippet}</FormField
      >
      <FormField id="checklist-date" label="Datum der Aktion" error={fields.dueDate}
        >{#snippet children(attrs)}<GermanDateInput
            {...attrs}
            value={date}
            required
            onchange={(value) => (date = value)}
          />{/snippet}</FormField
      >
      <p class="text-sm text-neutral-700">
        Die Vorlage wird einmal je Projekt angewendet. Zuständigkeiten und Fristen kannst du danach
        in den Aufgaben ändern.
      </p>
    {/if}
  </div>
</EditDialog>
