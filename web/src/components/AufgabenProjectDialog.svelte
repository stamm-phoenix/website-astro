<script lang="ts">
  import { untrack } from 'svelte';
  import { sendApi } from '../lib/api';
  import { TASK_ENDPOINT } from '../lib/aufgabenStore.svelte';
  import { createTaskForm } from '../lib/aufgabenForm.svelte';
  import EditDialog from './pflege/EditDialog.svelte';
  import FormField from './pflege/FormField.svelte';
  import type { TaskProject } from '../lib/types';
  let {
    target,
    onclose,
    onsaved,
  }: {
    target: TaskProject;
    onclose: () => void;
    onsaved: (message: string) => void;
  } = $props();
  let title = $state(untrack(() => target.title));
  const form = createTaskForm();
  const fields = $derived(form.state.fields);
  const busy = $derived(form.state.busy);
  async function save(): Promise<void> {
    await form.submit(async () => {
      const result = await sendApi<{ count: number }>('PUT', `${TASK_ENDPOINT}/projekte`, {
        from: target.title,
        title,
      });
      return `Projekt umbenannt. ${result.count} ${result.count === 1 ? 'Aufgabe heißt' : 'Aufgaben heißen'} jetzt „${title.trim()}“.`;
    }, onsaved);
  }
</script>

<EditDialog
  open
  title={`Projekt „${target.title}“ umbenennen`}
  {busy}
  error={form.state.error}
  onedit={form.changed}
  submitLabel="Projekt umbenennen"
  onsubmit={save}
  {onclose}
>
  <div class="space-y-4">
    <FormField
      id="project-title"
      label="Neuer Name"
      error={fields.title}
      hint="Der Name ändert sich bei allen Aufgaben des Projekts. Heißt schon ein anderes Projekt so, werden beide zusammengelegt."
      >{#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          bind:value={title}
          maxlength="200"
          required
        />{/snippet}</FormField
    >
  </div>
</EditDialog>
