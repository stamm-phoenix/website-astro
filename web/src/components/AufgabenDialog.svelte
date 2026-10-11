<script lang="ts">
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

  interface Props {
    dialog: 'task' | 'project' | 'template' | 'checklist' | null;
    draft: TaskInput;
    campflowId: string;
    items: TemplateItem[];
    templateId: number | null;
    date: string;
    target: Task | TaskProject | TaskTemplate | null;
    data: TasksOverview | null;
    busy: boolean;
    dialogError: string | null;
    fields: Record<string, string>;
    onsubmit: () => void;
  }
  let {
    dialog = $bindable(),
    draft = $bindable(),
    campflowId = $bindable(),
    items = $bindable(),
    templateId = $bindable(),
    date = $bindable(),
    target,
    data,
    busy,
    dialogError,
    fields,
    onsubmit,
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
      <FormField
        id="task-assignee"
        label="Zuständigkeit"
        optional
        error={fields.assignee}
        hint="Name oder Stammes-Login. Mit einem Login erscheint die Aufgabe im persönlichen Filter."
        >{#snippet children(attrs)}<input
            {...attrs}
            class="form-input"
            bind:value={draft.assignee}
            maxlength="254"
          />{/snippet}</FormField
      >
      <FormField id="task-due" label="Fälligkeit" optional error={fields.dueDate}
        >{#snippet children(attrs)}<input
            {...attrs}
            type="date"
            class="form-input"
            value={draft.dueDate ?? ''}
            oninput={(e) => (draft.dueDate = e.currentTarget.value || null)}
          />{/snippet}</FormField
      >
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
            ><option value={null}>{dialog === 'task' ? 'Ohne Projekt' : 'Bitte auswählen'}</option
            >{#each data?.projects ?? [] as project (project.id)}<option value={project.id}
                >{project.title}</option
              >{/each}</select
          >
        {/snippet}</FormField
      >
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
          <FormField id="template-assignee-{index}" label="Zuständigkeit" optional
            >{#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                bind:value={item.assignee}
                maxlength="254"
              />{/snippet}</FormField
          >
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
        >{#snippet children(attrs)}<input
            {...attrs}
            class="form-input"
            type="date"
            bind:value={date}
            required
          />{/snippet}</FormField
      >
      <p class="text-sm text-neutral-700">
        Die Vorlage wird einmal je Projekt angewendet. Zuständigkeiten und Fristen kannst du danach
        in den Aufgaben ändern.
      </p>
    {/if}
  </div>
</EditDialog>
