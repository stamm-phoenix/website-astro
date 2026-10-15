<script lang="ts">
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import { ApiError, errorMessage } from '../../lib/api';
  import type { StaffProtokoll } from '../../lib/types';
  interface Props {
    rejecting: { protokoll: StaffProtokoll; note: string } | null;
    busyId: string | null;
    changeState: (protokoll: StaffProtokoll, action: 'reject', note: string) => Promise<void>;
  }
  let { rejecting = $bindable(), busyId, changeState }: Props = $props();
  let rejectError = $state<string | null>(null);
  let rejectFieldError = $state<string | null>(null);

  async function submitReject(): Promise<void> {
    if (!rejecting) return;
    rejectError = null;
    rejectFieldError = null;
    try {
      await changeState(rejecting.protokoll, 'reject', rejecting.note);
      rejecting = null;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields?.note) rejectFieldError = error.fields.note;
      else
        rejectError = errorMessage(
          error,
          'Das Protokoll wurde nicht zurückgegeben. Dein Hinweis ist noch da. Tippe noch einmal auf „Zurückgeben“.'
        );
    }
  }
</script>

<EditDialog
  open={rejecting !== null}
  title="Protokoll zurückgeben"
  busy={busyId !== null && busyId === rejecting?.protokoll.id}
  error={rejectError}
  submitLabel="Zurückgeben"
  busyLabel="Wird zurückgegeben …"
  onsubmit={submitReject}
  onclose={() => {
    if (busyId === null) rejecting = null;
  }}
>
  {#if rejecting}
    <FormField
      id="protokoll-note"
      label="Was fehlt noch?"
      hint={rejecting.protokoll.createdBy
        ? `Geht per Mail an ${rejecting.protokoll.createdBy}.`
        : undefined}
      error={rejectFieldError ?? undefined}
    >
      {#snippet children(attrs)}
        <textarea
          {...attrs}
          class="form-input"
          rows="4"
          maxlength="2000"
          required
          bind:value={rejecting!.note}></textarea>
      {/snippet}
    </FormField>
  {/if}
</EditDialog>
