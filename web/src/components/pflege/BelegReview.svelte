<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from './FormField.svelte';
  import BelegStatusLabel from './BelegStatusLabel.svelte';
  import BelegCampflowTransfer from './BelegCampflowTransfer.svelte';
  import type { BelegForm, CampflowChoice } from '../../lib/belegForm';
  import type { BelegStatus } from '../../lib/types';
  interface Props {
    form: BelegForm;
    reviewer: boolean;
    busy: boolean;
    errors: Record<string, string>;
    onsave: (decision: BelegStatus) => void;
    ontransfer: (choice: CampflowChoice) => void;
    ondeleteuploaded: () => void;
  }
  let {
    form = $bindable(),
    reviewer,
    busy,
    errors,
    onsave,
    ontransfer,
    ondeleteuploaded,
  }: Props = $props();
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
        hint={`Pflicht beim Ablehnen; geht dann per Mail an ${form.submittedBy || 'die Person, die den Beleg eingereicht hat'}.`}
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
      <BelegCampflowTransfer {form} {busy} {ontransfer} ondelete={ondeleteuploaded} />
    {/if}
  </fieldset>
{/if}
