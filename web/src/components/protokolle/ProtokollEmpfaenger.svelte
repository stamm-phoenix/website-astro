<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import PersonSuche from '../ui/PersonSuche.svelte';
  import type { SuchPerson } from '../ui/PersonSuche.svelte';
  import type { ProtokollRecipient } from '../../lib/protokolleView';
  import { MAX_EXTRA_RECIPIENTS, isEmailAddress } from '../../lib/protokolleView';
  import { isIch } from '../../lib/ichStore.svelte';

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
    /** What the recipients get, e.g. „das Protokoll“ or „die Nachricht“. */
    subject?: string;
    /** Shown when CampFlow has nobody with an address. */
    emptyText?: string;
    /** ID of the address field; unique on the page. */
    fieldId?: string;
    /**
     * People to offer in the address field, e.g. from the module „Personen“; `gruppe` is the
     * heading. Without it, the field takes typed addresses only.
     */
    personen?: { name: string; email: string; gruppe?: string }[];
  }

  let {
    list,
    excluded = $bindable(),
    extra = $bindable(),
    pending = $bindable(),
    disabled = false,
    subject = 'das Protokoll',
    emptyText = 'In CampFlow wurden keine Leitenden und niemand mit dem Merkmal „Protokollempfang“ mit E-Mail gefunden.',
    fieldId = 'protokoll-extra',
    personen,
  }: Props = $props();

  let extraError = $state('');
  let notice = $state('');
  const selected = $derived(list.filter((r) => !excluded.includes(r.email)).length);
  const sorted = $derived(
    [...list].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'de'))
  );

  /** People not on the list with a tick and not added yet; the address is the login. */
  const suchPersonen = $derived<SuchPerson[]>(
    (personen ?? [])
      .filter(
        (p) =>
          !extra.includes(p.email) &&
          !list.some((r) => r.email === p.email && !excluded.includes(r.email))
      )
      .map((p) => ({ login: p.email, name: p.name, gruppe: p.gruppe }))
  );

  /** Name of an added address, if it belongs to one of `personen`. */
  function nameOf(address: string): string {
    return personen?.find((p) => p.email === address)?.name ?? '';
  }

  function toggle(address: string, checked: boolean): void {
    excluded = checked ? excluded.filter((e) => e !== address) : [...excluded, address];
  }

  /** Adds the typed address, or `chosen` (a picked person or text confirmed in the search). */
  function add(chosen?: string): void {
    const address = (chosen ?? pending).trim().toLowerCase();
    if (!address) {
      // Leaving the search for the button took the text over already
      if (!notice) extraError = 'Bitte gib eine E-Mail-Adresse ein.';
      return;
    }
    extraError = '';
    notice = '';
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
        notice = `${address} steht schon in der Liste und bekommt ${subject}.`;
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
    <legend class="form-label">Empfänger*innen ({selected} von {list.length})</legend>
    <p class="text-xs text-neutral-700">Gilt nur für diesen Versand.</p>
    {#if list.length === 0}
      <p class="text-sm text-danger">{emptyText}</p>
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
                  {recipient.name ||
                    recipient.email}{#if isIch({ name: recipient.name, ich: recipient.ich })}
                    <span class="font-normal text-neutral-700">(ich)</span>{/if}
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
      id={fieldId}
      label={personen ? 'Weitere Person oder E-Mail-Adresse' : 'Weitere E-Mail-Adresse'}
      optional
      error={extraError}
    >
      {#snippet children(field)}
        <div class="flex flex-wrap gap-2">
          {#if personen}
            <div class="min-w-0 flex-1 basis-48">
              <PersonSuche
                {...field}
                inputmode="email"
                class="form-input w-full"
                placeholder="Name oder E-Mail"
                listLabel="Person hinzufügen"
                options={suchPersonen}
                {disabled}
                bind:query={pending}
                onpick={(person) => add(person.login)}
                oncommit={(text) => add(text)}
              />
            </div>
          {:else}
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
          {/if}
          <ActionButton {disabled} onclick={() => add()}>Hinzufügen</ActionButton>
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
              {#if nameOf(address)}<span class="block font-semibold">{nameOf(address)}</span>
                <span class="block text-xs text-neutral-700">{address}</span>{:else}{address}{/if}
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
