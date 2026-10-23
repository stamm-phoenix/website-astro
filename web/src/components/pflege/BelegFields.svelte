<script lang="ts">
  import { getContext } from 'svelte';
  import FormField from './FormField.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import { todayIso } from '../../lib/format';
  import {
    applyZahlung,
    knownBelegAktion,
    type BelegForm,
    type BelegZahlung,
  } from '../../lib/belegForm';
  import { belegPersonen, fetchBelegPersonen } from '../../lib/belegPersonen.svelte';
  import { campflowEventsStore } from '../../lib/campflowStore.svelte';
  interface Props {
    form: BelegForm;
    errors: Record<string, string>;
    aktionSuggestions: string[];
    /** The name of the logged-in person, for the own Auslage. */
    myName: string;
    onpayment: () => void;
    onfield: (field: string) => void;
  }
  let {
    form = $bindable(),
    errors,
    aktionSuggestions,
    myName,
    onpayment,
    onfield,
  }: Props = $props();

  const ZAHLUNGEN: { value: BelegZahlung; label: string }[] = [
    { value: 'ich', label: 'Mit meinem Geld – bitte an mich auszahlen' },
    { value: 'andere', label: 'Jemand anderes hat ausgelegt – an diese Person auszahlen' },
    { value: 'stamm', label: 'Mit Stammeskarte / aus der Kasse' },
    { value: 'sparbuch', label: 'Umbuchung aufs Sparbuch' },
  ];
  const personen = $derived(belegPersonen.names.map((name) => ({ value: name })));
  const aktionen = $derived(aktionSuggestions.map((title) => ({ value: title })));

  // Names from the module „Personen“ to pick from; any other name can be typed
  $effect(() => {
    if (form.zahlung === 'andere') void fetchBelegPersonen();
  });
  const notifyEdited = getContext<(() => void) | undefined>('form-edited');
  const unknownAktion = $derived(
    !!form.aktion.trim() && !knownBelegAktion(form.aktion, aktionSuggestions)
  );
  const relatedAktionen = $derived(
    unknownAktion
      ? aktionSuggestions
          .filter((title) =>
            title.toLocaleLowerCase('de').includes(form.aktion.trim().toLocaleLowerCase('de'))
          )
          .slice(0, 3)
      : []
  );
</script>

<div class="grid gap-4 sm:grid-cols-2">
  <FormField id="bl-shop" label="Geschäft" error={errors.shop}>
    {#snippet children(attrs)}
      <input
        {...attrs}
        class="form-input"
        maxlength="100"
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
  <FormField id="bl-aktion" label="Aktion" error={errors.aktion} class="sm:col-span-2">
    {#snippet children(attrs)}
      <VorschlagFeld
        {...attrs}
        maxlength={120}
        placeholder="z. B. Sommerlager oder Gruppenstunde Wölflinge"
        options={aktionen}
        loading={campflowEventsStore.loading}
        listLabel="Aktion auswählen"
        bind:value={form!.aktion}
        onedit={() => onfield('aktion')}
      />
      {#if unknownAktion}
        <div class="mt-2 text-sm text-neutral-700" aria-live="polite">
          {#if relatedAktionen.length}
            <p>Meinst du eine dieser Aktionen?</p>
            <div class="flex flex-wrap gap-x-4">
              {#each relatedAktionen as title (title)}
                <button
                  type="button"
                  class="min-h-11 text-left font-semibold text-link underline"
                  onclick={() => {
                    form.aktion = title;
                    notifyEdited?.();
                  }}>{title}</button
                >
              {/each}
            </div>
          {:else}
            <p>
              Nicht in der Aktionsliste – beschreibe den Zweck so genau, dass die Kasse ihn zuordnen
              kann.
            </p>
          {/if}
        </div>
      {/if}
    {/snippet}
  </FormField>
</div>

<fieldset class="space-y-2" aria-describedby={errors.payout ? 'bl-payout-error' : undefined}>
  <legend class="form-label">Wie wurde bezahlt?</legend>
  {#each ZAHLUNGEN as option (option.value)}
    <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input
        type="radio"
        name="bl-payment-method"
        class="size-6 shrink-0 accent-[var(--color-action)]"
        checked={form.zahlung === option.value}
        onchange={() => {
          applyZahlung(form, option.value, myName);
          onpayment();
        }}
      />
      <span>{option.label}</span>
    </label>
    {#if option.value === 'andere' && form.zahlung === 'andere'}
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
