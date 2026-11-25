<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import Aktionsraster from '../ui/Aktionsraster.svelte';
  import FormField from './FormField.svelte';
  import BelegStatusLabel from './BelegStatusLabel.svelte';
  import BelegCampflowTransfer from './BelegCampflowTransfer.svelte';
  import type { BelegForm } from '../../lib/belegForm';
  import type { BelegStatus } from '../../../../api/lib/validation/beleg';
  interface Props {
    form: BelegForm;
    reviewer: boolean;
    busy: boolean;
    errors: Record<string, string>;
    onsave: (decision: BelegStatus) => void;
    ontransfer: () => void;
  }
  let { form = $bindable(), reviewer, busy, errors, onsave, ontransfer }: Props = $props();
</script>

{#if form.id}
  <fieldset class="space-y-4 rounded-md border border-neutral-200 p-4">
    <legend class="form-label px-1">Prüfung durch die Kasse</legend>
    <BelegStatusLabel status={form.status} />
    {#if !reviewer}
      {#if form.reviewNote}
        <p class="text-sm text-neutral-800">
          <span class="font-semibold">Bemerkung der Kasse:</span>
          {form.reviewNote}
        </p>
      {/if}
      {#if form.status === 'Abgelehnt'}
        <Aktionsraster>
          <ActionButton
            class="col-span-2"
            variant="primary"
            type="button"
            disabled={busy}
            onclick={() => onsave('Eingereicht')}
          >
            Erneut einreichen
          </ActionButton>
        </Aktionsraster>
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
      <Aktionsraster>
        {#if form.status !== 'Angenommen'}
          <ActionButton
            class={form.status === 'Abgelehnt' ? 'col-span-2' : ''}
            variant="primary"
            type="button"
            disabled={busy}
            onclick={() => onsave('Angenommen')}
          >
            Annehmen
          </ActionButton>
        {:else}
          <!-- An accepted receipt keeps its details; taking it back opens them again -->
          <ActionButton
            class="col-span-2"
            variant="secondary"
            type="button"
            disabled={busy}
            onclick={() => onsave('Eingereicht')}
          >
            Annahme zurücknehmen
          </ActionButton>
        {/if}
        {#if form.status !== 'Abgelehnt'}
          <ActionButton
            variant="danger"
            type="button"
            disabled={busy}
            onclick={() => onsave('Abgelehnt')}
          >
            Ablehnen
          </ActionButton>
        {:else}
          <ActionButton
            class="col-span-2"
            variant="secondary"
            type="button"
            disabled={busy}
            onclick={() => onsave('Eingereicht')}
          >
            Erneut einreichen
          </ActionButton>
        {/if}
      </Aktionsraster>
    {/if}
    {#if reviewer && form.status === 'Angenommen'}
      <BelegCampflowTransfer {form} {busy} {ontransfer} />
    {/if}
  </fieldset>
{/if}
