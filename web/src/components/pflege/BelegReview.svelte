<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from './FormField.svelte';
  import BelegStatusLabel from './BelegStatusLabel.svelte';
  import type { BelegForm } from '../../lib/belegForm';
  import type { BelegStatus } from '../../lib/types';
  interface Props {
    form: BelegForm;
    reviewer: boolean;
    busy: boolean;
    errors: Record<string, string>;
    onsave: (decision: BelegStatus) => void;
  }
  let { form = $bindable(), reviewer, busy, errors, onsave }: Props = $props();
</script>

{#if form.id}
  <fieldset class="space-y-4 rounded-md border border-neutral-200 p-4">
    <legend class="form-label px-1">Prüfung durch die Kasse</legend>
    <p class="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
      Status: <BelegStatusLabel status={form.status} />
    </p>
    {#if !reviewer}
      {#if form.reviewNote}
        <p class="text-sm text-neutral-800">
          <span class="font-semibold">Bemerkung der Kasse:</span>
          {form.reviewNote}
        </p>
      {/if}
      {#if form.status === 'Abgelehnt'}
        <ActionButton
          variant="secondary"
          type="button"
          disabled={busy}
          onclick={() => onsave('Eingereicht')}>Erneut einreichen</ActionButton
        >
      {/if}
    {:else}
      <FormField
        id="bl-review-note"
        label="Bemerkung der Kasse"
        hint={`Geht per Mail an ${form.submittedBy || 'die Person, die den Beleg eingereicht hat'}.`}
        error={errors.reviewNote}
      >
        {#snippet children(attrs)}
          <textarea
            {...attrs}
            class="form-input"
            rows="2"
            maxlength="1000"
            bind:value={form!.reviewNote}></textarea>
        {/snippet}
      </FormField>
      <div class="flex flex-wrap gap-2">
        {#if form.status !== 'Angenommen'}
          <ActionButton
            variant="primary"
            type="button"
            disabled={busy}
            onclick={() => onsave('Angenommen')}>Annehmen</ActionButton
          >
        {/if}
        {#if form.status !== 'Abgelehnt'}
          <ActionButton
            variant="danger"
            type="button"
            disabled={busy}
            onclick={() => onsave('Abgelehnt')}>Ablehnen</ActionButton
          >
        {:else}
          <ActionButton
            variant="secondary"
            type="button"
            disabled={busy}
            onclick={() => onsave('Eingereicht')}>Erneut einreichen</ActionButton
          >
        {/if}
      </div>
    {/if}
    {#if reviewer && form.status === 'Angenommen'}
      <p class="text-xs text-neutral-700">
        Foto herunterladen, in CampFlow als Beleg hochladen und den Beleg hier löschen.
      </p>
    {/if}
  </fieldset>
{/if}
