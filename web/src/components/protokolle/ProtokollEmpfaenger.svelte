<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import type { ProtokollRecipient } from '../../lib/protokolleView';
  import { MAX_EXTRA_RECIPIENTS, isEmailAddress } from '../../lib/protokolleView';

  interface Props {
    /** Recipients from CampFlow, with the reasons why. */
    list: ProtokollRecipient[];
    /** Addresses taken out for this delivery. */
    excluded: string[];
    /** Addresses added by hand for this delivery. */
    extra: string[];
    /** Text in the address field that was not added yet. */
    pending: string;
    disabled?: boolean;
  }

  let {
    list,
    excluded = $bindable(),
    extra = $bindable(),
    pending = $bindable(),
    disabled = false,
  }: Props = $props();

  let extraError = $state('');
  let notice = $state('');
  const selected = $derived(list.filter((r) => !excluded.includes(r.email)).length);
  const sorted = $derived(
    [...list].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'de'))
  );

  function toggle(address: string, checked: boolean): void {
    excluded = checked ? excluded.filter((e) => e !== address) : [...excluded, address];
  }

  function add(): void {
    const address = pending.trim().toLowerCase();
    extraError = '';
    notice = '';
    if (!address) {
      extraError = 'Bitte gib eine E-Mail-Adresse ein.';
      return;
    }
    if (!isEmailAddress(address)) {
      extraError = 'Bitte gib eine gültige E-Mail-Adresse ein, zum Beispiel name@beispiel.de.';
      return;
    }
    const listed = list.find((r) => r.email === address);
    if (listed) {
      if (excluded.includes(address)) {
        excluded = excluded.filter((e) => e !== address);
        notice = `${address} steht schon in der Liste. Das Häkchen ist wieder gesetzt.`;
      } else {
        notice = `${address} steht schon in der Liste und bekommt das Protokoll.`;
      }
      pending = '';
      return;
    }
    if (extra.includes(address)) {
      notice = `${address} ist schon eingetragen.`;
      pending = '';
      return;
    }
    if (extra.length >= MAX_EXTRA_RECIPIENTS) {
      extraError = `Du kannst höchstens ${MAX_EXTRA_RECIPIENTS} weitere Adressen eintragen.`;
      return;
    }
    extra = [...extra, address];
    notice = `${address} hinzugefügt.`;
    pending = '';
  }
</script>

<div class="space-y-4">
  <fieldset class="space-y-2" {disabled}>
    <legend class="form-label">Aus CampFlow ({selected} von {list.length} ausgewählt)</legend>
    <p class="text-xs text-neutral-700">
      Nimm das Häkchen raus, wenn jemand das Protokoll diesmal nicht bekommen soll. Das gilt nur für
      diesen Versand, in CampFlow ändert sich nichts. Die Liste ist nach Namen sortiert, scroll
      darin, um alle zu sehen.
    </p>
    {#if list.length === 0}
      <p class="text-sm text-danger">
        In CampFlow wurden keine Leitenden und niemand mit dem Label „Protokollempfang“ mit E-Mail
        gefunden.
      </p>
    {:else}
      <ul
        class="max-h-72 overflow-y-auto border border-neutral-200"
        aria-label="Empfänger*innen aus CampFlow"
      >
        {#each sorted as recipient (recipient.email)}
          <li class="border-t border-neutral-200 first:border-t-0">
            <label class="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2">
              <input
                type="checkbox"
                class="mt-1 size-5 shrink-0 accent-action"
                checked={!excluded.includes(recipient.email)}
                onchange={(event) => toggle(recipient.email, event.currentTarget.checked)}
              />
              <span class="min-w-0">
                <span class="block text-sm font-semibold break-words text-neutral-900">
                  {recipient.name || recipient.email}
                </span>
                {#if recipient.name}
                  <span class="block text-xs break-all text-neutral-700">{recipient.email}</span>
                {/if}
                <span class="block text-xs text-neutral-700">
                  {recipient.reasons.join(' · ')}
                </span>
              </span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}
  </fieldset>

  <div class="space-y-2">
    <FormField
      id="protokoll-extra"
      label="Weitere E-Mail-Adresse"
      optional
      hint="Nur für diesen Versand, die Adresse wird nicht gespeichert."
      error={extraError}
    >
      {#snippet children(field)}
        <div class="flex flex-wrap gap-2">
          <input
            {...field}
            type="email"
            autocomplete="email"
            inputmode="email"
            class="form-input min-w-0 flex-1 basis-48"
            {disabled}
            bind:value={pending}
            onkeydown={(event) => {
              // Enter adds the address instead of sending the minutes
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
          />
          <ActionButton {disabled} onclick={add}>Hinzufügen</ActionButton>
        </div>
      {/snippet}
    </FormField>
    <p class="text-sm text-neutral-800" role="status" aria-live="polite">{notice}</p>
    {#if extra.length > 0}
      <ul class="border border-neutral-200" aria-label="Von Hand eingetragene Adressen">
        {#each extra as address (address)}
          <li
            class="flex min-h-11 items-center justify-between gap-3 border-t border-neutral-200 px-3 py-1 first:border-t-0"
          >
            <span class="min-w-0 text-sm break-all text-neutral-900">
              {address}
              <span class="block text-xs text-neutral-700">Von Hand eingetragen</span>
            </span>
            <ActionButton
              {disabled}
              aria-label={`${address} entfernen`}
              onclick={() => {
                extra = extra.filter((e) => e !== address);
                notice = `${address} entfernt.`;
              }}>Entfernen</ActionButton
            >
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
