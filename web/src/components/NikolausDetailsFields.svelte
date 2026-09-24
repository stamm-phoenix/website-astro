<script lang="ts">
  import { NIKOLAUS_MAX_LENGTH } from '../lib/nikolausConfig';
  import type { NikolausDetailsField } from '../lib/nikolausConfig';

  interface Props {
    familyName: string;
    email: string;
    phone: string;
    withKrampus: 'ja' | 'nein' | null;
    errors: Partial<Record<NikolausDetailsField, string>>;
    /** Prefix for element IDs, so the fields can appear on several pages. */
    idPrefix: string;
    emailHint?: string;
  }

  let {
    familyName = $bindable(),
    email = $bindable(),
    phone = $bindable(),
    withKrampus = $bindable(),
    errors = $bindable(),
    idPrefix,
    emailHint = 'An diese Adresse schicken wir den Bestätigungslink.',
  }: Props = $props();

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
</script>

<div class="grid gap-5 md:grid-cols-2">
  <div class="md:col-span-2">
    <label for="{idPrefix}-familyName" class="text-sm font-semibold text-brand-900">
      Familienname
    </label>
    <input
      id="{idPrefix}-familyName"
      type="text"
      autocomplete="family-name"
      maxlength={NIKOLAUS_MAX_LENGTH.familyName}
      required
      bind:value={familyName}
      oninput={() => clearError('familyName')}
      class={inputClass(!!errors.familyName)}
      aria-invalid={errors.familyName ? 'true' : undefined}
      aria-describedby={errors.familyName ? `${idPrefix}-familyName-error` : undefined}
    />
    {#if errors.familyName}
      <p id="{idPrefix}-familyName-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
        {errors.familyName}
      </p>
    {/if}
  </div>

  <div>
    <label for="{idPrefix}-email" class="text-sm font-semibold text-brand-900">E-Mail</label>
    <input
      id="{idPrefix}-email"
      type="email"
      autocomplete="email"
      maxlength={NIKOLAUS_MAX_LENGTH.email}
      required
      bind:value={email}
      oninput={() => clearError('email')}
      class={inputClass(!!errors.email)}
      aria-invalid={errors.email ? 'true' : undefined}
      aria-describedby="{idPrefix}-email-hint{errors.email ? ` ${idPrefix}-email-error` : ''}"
    />
    <p id="{idPrefix}-email-hint" class="mt-1 text-xs text-neutral-700">{emailHint}</p>
    {#if errors.email}
      <p id="{idPrefix}-email-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
        {errors.email}
      </p>
    {/if}
  </div>

  <div>
    <label for="{idPrefix}-phone" class="text-sm font-semibold text-brand-900">
      Telefon (möglichst Handynummer)
    </label>
    <input
      id="{idPrefix}-phone"
      type="tel"
      autocomplete="tel"
      maxlength={NIKOLAUS_MAX_LENGTH.phone}
      required
      bind:value={phone}
      oninput={() => clearError('phone')}
      class={inputClass(!!errors.phone)}
      aria-invalid={errors.phone ? 'true' : undefined}
      aria-describedby="{idPrefix}-phone-hint{errors.phone ? ` ${idPrefix}-phone-error` : ''}"
    />
    <p id="{idPrefix}-phone-hint" class="mt-1 text-xs text-neutral-700">
      Damit wir Sie am Besuchstag erreichen können.
    </p>
    {#if errors.phone}
      <p id="{idPrefix}-phone-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
        {errors.phone}
      </p>
    {/if}
  </div>

  <fieldset
    class="md:col-span-2"
    aria-describedby={errors.withKrampus ? `${idPrefix}-krampus-error` : undefined}
  >
    <legend class="text-sm font-semibold text-brand-900">Darf der Krampus mit reinkommen?</legend>
    <div class="mt-2 flex flex-wrap gap-3">
      <label class="choice" class:choice-checked={withKrampus === 'ja'}>
        <input
          type="radio"
          name="{idPrefix}-krampus"
          value="ja"
          bind:group={withKrampus}
          onchange={() => clearError('withKrampus')}
        />
        Ja, mit Krampus
      </label>
      <label class="choice" class:choice-checked={withKrampus === 'nein'}>
        <input
          type="radio"
          name="{idPrefix}-krampus"
          value="nein"
          bind:group={withKrampus}
          onchange={() => clearError('withKrampus')}
        />
        Nein, der Krampus bleibt draußen
      </label>
    </div>
    {#if errors.withKrampus}
      <p id="{idPrefix}-krampus-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
        {errors.withKrampus}
      </p>
    {/if}
  </fieldset>
</div>

<style>
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
