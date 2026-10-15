<script lang="ts">
  import FormField from './FormField.svelte';
  import { todayIso } from '../../lib/format';
  import type { BelegForm } from '../../lib/belegForm';
  interface Props {
    form: BelegForm;
    errors: Record<string, string>;
    aktionSuggestions: string[];
  }
  let { form = $bindable(), errors, aktionSuggestions }: Props = $props();
</script>

<div class="grid gap-4 sm:grid-cols-2">
  <FormField id="bl-shop" label="Geschäft" error={errors.shop}>
    {#snippet children(attrs)}
      <input {...attrs} class="form-input" maxlength="100" bind:value={form!.shop} />
    {/snippet}
  </FormField>
  <FormField id="bl-date" label="Datum des Belegs" error={errors.date}>
    {#snippet children(attrs)}
      <input {...attrs} type="date" class="form-input" max={todayIso()} bind:value={form!.date} />
    {/snippet}
  </FormField>
  <FormField
    id="bl-amount"
    label="Betrag in €"
    hint="Gesamtbetrag laut Beleg"
    error={errors.amountCent}
  >
    {#snippet children(attrs)}
      <input
        {...attrs}
        class="form-input"
        inputmode="decimal"
        placeholder="12,34"
        maxlength="12"
        autocomplete="off"
        bind:value={form!.amount}
      />
    {/snippet}
  </FormField>
  <FormField id="bl-paid-by" label="Bezahlt von" error={errors.paidBy}>
    {#snippet children(attrs)}
      <input {...attrs} class="form-input" maxlength="100" bind:value={form!.paidBy} />
    {/snippet}
  </FormField>
  <FormField
    id="bl-aktion"
    label="Aktion"
    hint="Aktion aus CampFlow oder z. B. „Gruppenstunde Wölflinge“"
    error={errors.aktion}
    class="sm:col-span-2"
  >
    {#snippet children(attrs)}
      <input
        {...attrs}
        class="form-input"
        maxlength="120"
        list="bl-aktion-suggestions"
        autocomplete="off"
        bind:value={form!.aktion}
      />
      <datalist id="bl-aktion-suggestions">
        {#each aktionSuggestions as title (title)}
          <option value={title}></option>
        {/each}
      </datalist>
    {/snippet}
  </FormField>
</div>

<label class="flex items-start gap-2 text-sm">
  <input type="checkbox" class="mt-1" bind:checked={form.payout} />
  <span>
    Mit eigenem Geld bezahlt – der Betrag soll ausgezahlt werden
    <span class="block text-xs text-neutral-700">
      Nicht ankreuzen, wenn mit der Stammeskarte oder aus der Kasse bezahlt wurde.
    </span>
  </span>
</label>

<FormField id="bl-note" label="Bemerkung" optional error={errors.note}>
  {#snippet children(attrs)}
    <textarea {...attrs} class="form-input" rows="2" maxlength="1000" bind:value={form!.note}
    ></textarea>
  {/snippet}
</FormField>
