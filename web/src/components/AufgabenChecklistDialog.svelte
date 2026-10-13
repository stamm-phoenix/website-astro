<script lang="ts">
  import { untrack } from 'svelte';
  import { sendApi } from '../lib/api';
  import { aufgabenStore, TASK_ENDPOINT } from '../lib/aufgabenStore.svelte';
  import { createTaskForm } from '../lib/aufgabenForm.svelte';
  import EditDialog from './pflege/EditDialog.svelte';
  import FormField from './pflege/FormField.svelte';
  import { taskToday } from '../lib/aufgabenView';
  import GermanDateInput from './ui/GermanDateInput.svelte';
  let {
    initialProjectId = null,
    onclose,
    onsaved,
  }: {
    initialProjectId?: number | null;
    onclose: () => void;
    onsaved: (message: string) => void;
  } = $props();
  let draft = $state(untrack(() => ({ projectId: initialProjectId })));
  let templateId = $state<number | null>(aufgabenStore.data?.templates[0]?.id ?? null);
  let date = $state(taskToday());
  const form = createTaskForm();
  const fields = $derived(form.state.fields);
  const busy = $derived(form.state.busy);
  const data = $derived(aufgabenStore.data);
  async function save(): Promise<void> {
    await form.submit(async () => {
      const result = await sendApi<{ count: number }>('POST', `${TASK_ENDPOINT}/checkliste`, {
        projectId: draft.projectId,
        templateId,
        date,
        etag: data?.templates.find((template) => template.id === templateId)?.etag,
      });
      return result.count
        ? `${result.count} ${result.count === 1 ? 'Aufgabe' : 'Aufgaben'} aus der Vorlage angelegt.`
        : 'Diese Vorlage wurde für das Projekt bereits angewendet.';
    }, onsaved);
  }
</script>

<EditDialog
  open
  title="Checkliste aus Vorlage"
  {busy}
  error={form.state.error}
  onedit={form.changed}
  onreload={form.state.conflict ? () => form.reload(() => {}) : undefined}
  submitLabel="Aufgaben anlegen"
  onsubmit={save}
  {onclose}
>
  <div class="space-y-4">
    <FormField id="task-project" label="Projekt" error={fields.projectId}
      >{#snippet children(attrs)}
        <select {...attrs} class="form-input" bind:value={draft.projectId} required
          ><option value={null}>Bitte auswählen</option
          >{#each data?.projects ?? [] as project (project.id)}<option value={project.id}
              >{project.title}</option
            >{/each}</select
        >
      {/snippet}</FormField
    >
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
      Die Vorlage wird einmal je Projekt angewendet. Zuständigkeiten und Fristen kannst du danach in
      den Aufgaben ändern.
    </p>
  </div>
</EditDialog>
