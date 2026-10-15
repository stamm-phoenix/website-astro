<script lang="ts">
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import { ApiError, errorMessage, sendApi } from '../../lib/api';
  import { protokollePflege } from '../../lib/pflegeStore.svelte';
  interface Props {
    creating: { title: string; date: string } | null;
    oncreated: () => void;
    notify: (text: string) => void;
  }
  let { creating = $bindable(), oncreated, notify }: Props = $props();
  let createErrors = $state<Record<string, string>>({});
  let createError = $state<string | null>(null);
  let createBusy = $state(false);

  async function create(): Promise<void> {
    if (!creating) return;
    createBusy = true;
    createErrors = {};
    createError = null;
    try {
      const { title, date } = creating;
      await sendApi<{ id: string; webUrl: string }>('POST', '/intern/pflege/protokolle', {
        title,
        date,
      });
      creating = null;
      oncreated();
      notify(`Protokoll „${title}“ angelegt. Öffne es mit „In Word bearbeiten“.`);
      await protokollePflege.load({ force: true });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) createErrors = error.fields;
      createError = errorMessage(
        error,
        'Das Protokoll wurde nicht angelegt. Deine Eingaben sind noch da. Tippe noch einmal auf „Anlegen“.'
      );
    } finally {
      createBusy = false;
    }
  }
</script>

<EditDialog
  open={creating !== null}
  title="Neues Protokoll"
  busy={createBusy}
  error={createError}
  submitLabel="Anlegen"
  busyLabel="Wird angelegt …"
  onsubmit={create}
  onclose={() => {
    if (!createBusy) creating = null;
  }}
>
  {#if creating}
    <FormField
      id="protokoll-title"
      label="Titel"
      hint="Zum Beispiel „Leitendenrunde“ oder „Stavo-Sitzung“"
      error={createErrors.title}
    >
      {#snippet children(attrs)}
        <input {...attrs} class="form-input" maxlength="80" required bind:value={creating!.title} />
      {/snippet}
    </FormField>
    <FormField id="protokoll-date" label="Datum der Sitzung" error={createErrors.date}>
      {#snippet children(attrs)}
        <input {...attrs} type="date" class="form-input" required bind:value={creating!.date} />
      {/snippet}
    </FormField>
    <p class="text-sm text-neutral-700">
      Die Datei heißt dann „{creating.date}
      {creating.title.trim()}.docx“.
    </p>
  {/if}
</EditDialog>
