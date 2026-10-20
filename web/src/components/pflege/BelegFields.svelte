<script lang="ts">
  import { getContext } from 'svelte';
  import FormField from './FormField.svelte';
  import { todayIso } from '../../lib/format';
  import { knownBelegAktion, type BelegForm } from '../../lib/belegForm';
  interface Props {
    form: BelegForm;
    errors: Record<string, string>;
    aktionSuggestions: string[];
    onpayment: () => void;
  }
  let { form = $bindable(), errors, aktionSuggestions, onpayment }: Props = $props();
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
      <input {...attrs} class="form-input" maxlength="100" bind:value={form!.shop} />
    {/snippet}
  </FormField>
  <FormField id="bl-date" label="Datum des Belegs" error={errors.date}>
    {#snippet children(attrs)}
      <input {...attrs} type="date" class="form-input" max={todayIso()} bind:value={form!.date} />
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
      />
    {/snippet}
  </FormField>
  <FormField id="bl-paid-by" label="Bezahlt von" error={errors.paidBy}>
    {#snippet children(attrs)}
      <input {...attrs} class="form-input" maxlength="100" bind:value={form!.paidBy} />
    {/snippet}
  </FormField>
  <FormField id="bl-aktion" label="Aktion" error={errors.aktion} class="sm:col-span-2">
    {#snippet children(attrs)}
      <input
        {...attrs}
        class="form-input"
        maxlength="120"
        list="bl-aktion-suggestions"
        autocomplete="off"
        placeholder="z. B. Sommerlager oder Gruppenstunde Wölflinge"
        bind:value={form!.aktion}
      />
      <datalist id="bl-aktion-suggestions">
        {#each aktionSuggestions as title (title)}
          <option value={title}></option>
        {/each}
      </datalist>
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
  <legend class="form-label">Wie hast du bezahlt?</legend>
  {#each [{ value: true, label: 'Mit meinem Geld – bitte an mich auszahlen' }, { value: false, label: 'Mit Stammeskarte / aus der Kasse' }] as option (option.label)}
    <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input
        type="radio"
        name="bl-payment-method"
        class="size-6 shrink-0 accent-[var(--color-action)]"
        checked={form.payout === option.value}
        onchange={() => {
          form.payout = option.value;
          onpayment();
        }}
      />
      <span>{option.label}</span>
    </label>
  {/each}
  {#if errors.payout}<p id="bl-payout-error" class="text-sm text-danger">{errors.payout}</p>{/if}
</fieldset>

<FormField id="bl-note" label="Bemerkung" optional error={errors.note}>
  {#snippet children(attrs)}
    <textarea {...attrs} class="form-input" rows="2" maxlength="1000" bind:value={form!.note}
    ></textarea>
  {/snippet}
</FormField>
