<script lang="ts">
  import BelegZuordnung from './BelegZuordnung.svelte';
  import FormField from './FormField.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import { todayIso } from '../../lib/format';
  import { applyArt, applyZahlung, type BelegForm, type BelegZahlung } from '../../lib/belegForm';
  import type { BelegArt } from '../../lib/types';
  import { belegPersonen, fetchBelegPersonen } from '../../lib/belegPersonen.svelte';
  interface Props {
    form: BelegForm;
    errors: Record<string, string>;
    /** The name of the logged-in person, for the own Auslage. */
    /** Name an Auslage starts with: the person submitting a new receipt. */
    vorschlag: string;
    onpayment: () => void;
    onfield: (field: string) => void;
  }
  let { form = $bindable(), errors, vorschlag, onpayment, onfield }: Props = $props();

  const ARTEN: { value: BelegArt; label: string }[] = [
    { value: 'Ausgabe', label: 'Ausgabe' },
    { value: 'Einnahme', label: 'Einnahme' },
  ];
  const einnahme = $derived(form.art === 'Einnahme');
  const ZAHLUNGEN: { value: BelegZahlung; label: string }[] = [
    { value: 'auslage', label: 'Privat ausgelegt – an diese Person auszahlen' },
    { value: 'stamm', label: 'Mit Stammeskarte / aus der Kasse' },
    { value: 'sparbuch', label: 'Umbuchung aufs Sparbuch' },
  ];
  const personen = $derived(belegPersonen.names.map((name) => ({ value: name })));

  // Names from the module „Personen“ to pick from; any other name can be typed
  $effect(() => {
    if (form.zahlung === 'auslage') void fetchBelegPersonen();
  });
</script>

<fieldset>
  <legend class="form-label">Art des Belegs</legend>
  <div class="flex flex-wrap gap-x-6">
    {#each ARTEN as option (option.value)}
      <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="radio"
          name="bl-art"
          class="size-6 shrink-0 accent-[var(--color-action)]"
          checked={form.art === option.value}
          onchange={() => {
            applyArt(form, option.value);
            onpayment();
          }}
        />
        <span>{option.label}</span>
      </label>
    {/each}
  </div>
</fieldset>

<div class="grid gap-4 sm:grid-cols-2">
  <FormField id="bl-shop" label={einnahme ? 'Einnahme von' : 'Geschäft'} error={errors.shop}>
    {#snippet children(attrs)}
      <input
        {...attrs}
        class="form-input"
        maxlength="100"
        placeholder={einnahme ? 'z. B. Spende Bäckerei Huber' : undefined}
        bind:value={form!.shop}
        oninput={() => onfield('shop')}
      />
    {/snippet}
  </FormField>
  <FormField id="bl-date" label="Datum des Belegs" error={errors.date}>
    {#snippet children(attrs)}
      <input
        {...attrs}
        type="date"
        class="form-input"
        max={todayIso()}
        bind:value={form!.date}
        oninput={() => onfield('date')}
      />
    {/snippet}
  </FormField>
  <FormField id="bl-amount" label="Betrag in €" error={errors.amountCent}>
    {#snippet children(attrs)}
      <input
        {...attrs}
        class="form-input"
        inputmode="decimal"
        placeholder="12,34"
        maxlength="12"
        autocomplete="off"
        bind:value={form!.amount}
        oninput={() => onfield('amountCent')}
      />
    {/snippet}
  </FormField>
  <BelegZuordnung bind:form {errors} {onfield} />
</div>

{#if !einnahme}
  <fieldset class="space-y-2" aria-describedby={errors.payout ? 'bl-payout-error' : undefined}>
    <legend class="form-label">Wie wurde bezahlt?</legend>
    {#each ZAHLUNGEN as option (option.value)}
      <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="radio"
          name="bl-payment-method"
          data-form-error={errors.payout && option.value === 'auslage' ? 'true' : undefined}
          aria-describedby={errors.payout ? 'bl-payout-error' : undefined}
          class="size-6 shrink-0 accent-[var(--color-action)]"
          checked={form.zahlung === option.value}
          onchange={() => {
            applyZahlung(form, option.value, vorschlag);
            onpayment();
          }}
        />
        <span>{option.label}</span>
      </label>
      {#if option.value === 'auslage' && form.zahlung === 'auslage'}
        <FormField id="bl-paid-by" label="Ausgelegt von" error={errors.paidBy} class="pl-9">
          {#snippet children(attrs)}
            <VorschlagFeld
              {...attrs}
              maxlength={100}
              placeholder="Name suchen oder eingeben"
              options={personen}
              loading={belegPersonen.loading}
              listLabel="Person auswählen"
              bind:value={form!.paidBy}
              onedit={() => onfield('paidBy')}
            />
          {/snippet}
        </FormField>
      {/if}
    {/each}
    {#if errors.payout}<p id="bl-payout-error" class="text-sm text-danger">{errors.payout}</p>{/if}
  </fieldset>
{/if}

<FormField id="bl-note" label="Bemerkung" optional error={errors.note}>
  {#snippet children(attrs)}
    <textarea
      {...attrs}
      class="form-input"
      rows="2"
      maxlength="1000"
      bind:value={form!.note}
      oninput={() => onfield('note')}></textarea>
  {/snippet}
</FormField>
