<script lang="ts">
  import { NIKOLAUS_CHILDREN_RANGE, NIKOLAUS_MAX_LENGTH } from '../lib/nikolausConfig';
  import type { NikolausDetailsField } from '../lib/nikolausConfig';
  import type { NikolausDetailsForm } from '../lib/types';
  import NikolausAddressMap from './NikolausAddressMap.svelte';

  interface Props {
    details: NikolausDetailsForm;
    errors: Partial<Record<NikolausDetailsField, string>>;
    /** Prefix for element IDs, so the fields can appear on several pages. */
    idPrefix: string;
    emailHint?: string;
  }

  let {
    details = $bindable(),
    errors = $bindable(),
    idPrefix,
    emailHint = 'An diese Adresse schicken wir den Bestätigungslink.',
  }: Props = $props();

  const max = NIKOLAUS_MAX_LENGTH;

  function clearError(name: NikolausDetailsField): void {
    if (errors[name]) errors = { ...errors, [name]: undefined };
  }

  function inputClass(hasError: boolean): string {
    return [
      'mt-1 block w-full rounded-md border bg-white px-3 py-2.5 text-base text-neutral-900 shadow-sm',
      'focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)]',
      hasError ? 'border-[var(--color-dpsg-red)]' : 'border-neutral-300',
    ].join(' ');
  }

  function describedBy(name: NikolausDetailsField, hint = false): string | undefined {
    const ids = [hint && `${idPrefix}-${name}-hint`, errors[name] && `${idPrefix}-${name}-error`];
    const joined = ids.filter(Boolean).join(' ');
    return joined || undefined;
  }
</script>

{#snippet error(name: NikolausDetailsField)}
  {#if errors[name]}
    <p id="{idPrefix}-{name}-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
      {errors[name]}
    </p>
  {/if}
{/snippet}

{#snippet optional()}
  <span class="font-normal text-neutral-700">(optional)</span>
{/snippet}

<div class="space-y-8">
  <!-- Contact -->
  <div>
    <h4 class="group-heading">Kontakt</h4>
    <div class="grid gap-5 md:grid-cols-2">
      <div class="md:col-span-2">
        <label for="{idPrefix}-familyName" class="label">Familienname</label>
        <input
          id="{idPrefix}-familyName"
          type="text"
          autocomplete="family-name"
          maxlength={max.familyName}
          required
          bind:value={details.familyName}
          oninput={() => clearError('familyName')}
          class={inputClass(!!errors.familyName)}
          aria-invalid={errors.familyName ? 'true' : undefined}
          aria-describedby={describedBy('familyName')}
        />
        {@render error('familyName')}
      </div>

      <div>
        <label for="{idPrefix}-email" class="label">E-Mail</label>
        <input
          id="{idPrefix}-email"
          type="email"
          autocomplete="email"
          maxlength={max.email}
          required
          bind:value={details.email}
          oninput={() => clearError('email')}
          class={inputClass(!!errors.email)}
          aria-invalid={errors.email ? 'true' : undefined}
          aria-describedby={describedBy('email', true)}
        />
        <p id="{idPrefix}-email-hint" class="mt-1 text-xs text-neutral-700">{emailHint}</p>
        {@render error('email')}
      </div>

      <div>
        <label for="{idPrefix}-phone" class="label">Telefon (möglichst Handynummer)</label>
        <input
          id="{idPrefix}-phone"
          type="tel"
          autocomplete="tel"
          maxlength={max.phone}
          required
          bind:value={details.phone}
          oninput={() => clearError('phone')}
          class={inputClass(!!errors.phone)}
          aria-invalid={errors.phone ? 'true' : undefined}
          aria-describedby={describedBy('phone', true)}
        />
        <p id="{idPrefix}-phone-hint" class="mt-1 text-xs text-neutral-700">
          Damit wir Sie am Besuchstag erreichen können.
        </p>
        {@render error('phone')}
      </div>
    </div>
  </div>

  <!-- Address -->
  <div>
    <h4 class="group-heading">Adresse</h4>
    <div class="grid gap-5 md:grid-cols-[2fr_1fr_2fr]">
      <div>
        <label for="{idPrefix}-street" class="label">Straße und Hausnummer</label>
        <input
          id="{idPrefix}-street"
          type="text"
          autocomplete="street-address"
          maxlength={max.street}
          required
          bind:value={details.street}
          oninput={() => clearError('street')}
          class={inputClass(!!errors.street)}
          aria-invalid={errors.street ? 'true' : undefined}
          aria-describedby={describedBy('street')}
        />
        {@render error('street')}
      </div>

      <div>
        <label for="{idPrefix}-postalCode" class="label">PLZ</label>
        <input
          id="{idPrefix}-postalCode"
          type="text"
          inputmode="numeric"
          autocomplete="postal-code"
          maxlength="5"
          required
          bind:value={details.postalCode}
          oninput={() => clearError('postalCode')}
          class={inputClass(!!errors.postalCode)}
          aria-invalid={errors.postalCode ? 'true' : undefined}
          aria-describedby={describedBy('postalCode')}
        />
        {@render error('postalCode')}
      </div>

      <div>
        <label for="{idPrefix}-city" class="label">Ort / Ortsteil</label>
        <input
          id="{idPrefix}-city"
          type="text"
          autocomplete="address-level2"
          maxlength={max.city}
          required
          bind:value={details.city}
          oninput={() => clearError('city')}
          class={inputClass(!!errors.city)}
          aria-invalid={errors.city ? 'true' : undefined}
          aria-describedby={describedBy('city')}
        />
        {@render error('city')}
      </div>

      <div class="md:col-span-3">
        <label for="{idPrefix}-addressNotes" class="label">
          Hinweise zur Adresse {@render optional()}
        </label>
        <textarea
          id="{idPrefix}-addressNotes"
          rows="2"
          maxlength={max.addressNotes}
          placeholder="z. B. Wegbeschreibung, Hinterhaus, Beschreibung der Wohnungstür oder Klingel"
          bind:value={details.addressNotes}
          oninput={() => clearError('addressNotes')}
          class={inputClass(!!errors.addressNotes)}
          aria-invalid={errors.addressNotes ? 'true' : undefined}
          aria-describedby={describedBy('addressNotes')}></textarea>
        {@render error('addressNotes')}
      </div>
    </div>

    <NikolausAddressMap
      street={details.street}
      postalCode={details.postalCode}
      city={details.city}
    />
  </div>

  <!-- Visit -->
  <div>
    <h4 class="group-heading">Für den Besuch</h4>
    <div class="grid gap-5 md:grid-cols-2">
      <div>
        <label for="{idPrefix}-childrenCount" class="label">Anzahl Kinder</label>
        <input
          id="{idPrefix}-childrenCount"
          type="number"
          inputmode="numeric"
          min={NIKOLAUS_CHILDREN_RANGE.min}
          max={NIKOLAUS_CHILDREN_RANGE.max}
          step="1"
          required
          bind:value={details.childrenCount}
          oninput={() => clearError('childrenCount')}
          class={inputClass(!!errors.childrenCount) + ' md:max-w-40'}
          aria-invalid={errors.childrenCount ? 'true' : undefined}
          aria-describedby={describedBy('childrenCount', true)}
        />
        <p id="{idPrefix}-childrenCount-hint" class="mt-1 text-xs text-neutral-700">
          Voraussichtliche Anzahl – für jedes Kind bitte einen Zettel fürs Goldene Buch vorbereiten.
        </p>
        {@render error('childrenCount')}
      </div>

      <fieldset aria-describedby={errors.withKrampus ? `${idPrefix}-withKrampus-error` : undefined}>
        <legend class="label">Darf der Krampus mit reinkommen?</legend>
        <div class="mt-2 flex flex-wrap gap-3">
          <label class="choice" class:choice-checked={details.withKrampus === 'ja'}>
            <input
              type="radio"
              name="{idPrefix}-krampus"
              value="ja"
              bind:group={details.withKrampus}
              onchange={() => clearError('withKrampus')}
            />
            Ja, mit Krampus
          </label>
          <label class="choice" class:choice-checked={details.withKrampus === 'nein'}>
            <input
              type="radio"
              name="{idPrefix}-krampus"
              value="nein"
              bind:group={details.withKrampus}
              onchange={() => clearError('withKrampus')}
            />
            Nein, der Krampus bleibt draußen
          </label>
        </div>
        {@render error('withKrampus')}
      </fieldset>

      <div class="md:col-span-2">
        <label for="{idPrefix}-hidingPlace" class="label">
          Wo legen Sie Geschenke, Zettel und Spende bereit?
        </label>
        <textarea
          id="{idPrefix}-hidingPlace"
          rows="2"
          maxlength={max.hidingPlace}
          required
          placeholder="z. B. im Korb neben der Haustür, in der Garage links"
          bind:value={details.hidingPlace}
          oninput={() => clearError('hidingPlace')}
          class={inputClass(!!errors.hidingPlace)}
          aria-invalid={errors.hidingPlace ? 'true' : undefined}
          aria-describedby={describedBy('hidingPlace', true)}></textarea>
        <p id="{idPrefix}-hidingPlace-hint" class="mt-1 text-xs text-neutral-700">
          Die Fahrer*in holt alles vor dem Besuch draußen ab. Zettel und Geschenke bitte nicht über
          dieses Formular schicken.
        </p>
        {@render error('hidingPlace')}
      </div>

      <div class="md:col-span-2">
        <label for="{idPrefix}-notes" class="label">Sonstige Bemerkungen {@render optional()}</label
        >
        <textarea
          id="{idPrefix}-notes"
          rows="3"
          maxlength={max.notes}
          bind:value={details.notes}
          oninput={() => clearError('notes')}
          class={inputClass(!!errors.notes)}
          aria-invalid={errors.notes ? 'true' : undefined}
          aria-describedby={describedBy('notes')}></textarea>
        {@render error('notes')}
      </div>
    </div>
  </div>
</div>

<style>
  .group-heading {
    margin-bottom: 0.75rem;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-dpsg-red);
  }
  .label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-brand-900);
  }
  .choice {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    border-radius: 999px;
    border: 2px solid var(--color-brand-200);
    background: white;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-brand-900);
  }
  .choice input {
    accent-color: var(--color-dpsg-red);
  }
  .choice:has(input:focus-visible) {
    outline: 3px solid var(--color-dpsg-red);
    outline-offset: 2px;
  }
  .choice-checked {
    border-color: var(--color-dpsg-red);
  }
</style>
