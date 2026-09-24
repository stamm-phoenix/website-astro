<script lang="ts">
  import { untrack } from 'svelte';
  import { nikolausStore, fetchNikolausSlots } from '../lib/nikolausStore.svelte';
  import { ApiError, postApi } from '../lib/api';
  import { formatNikolausDate, NIKOLAUS_CONFIG } from '../lib/nikolausConfig';
  import type { NikolausBookingCreated, NikolausBookingRequest, NikolausSlot } from '../lib/types';

  type FieldName = 'slot' | 'familyName' | 'email' | 'phone' | 'withKrampus';

  const REFRESH_INTERVAL_MS = 60_000;
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_PATTERN = /^\+?[0-9 ()/-]{5,30}$/;

  let selectedDate = $state<string | null>(null);
  let selectedSlot = $state<string | null>(null);
  let familyName = $state('');
  let email = $state('');
  let phone = $state('');
  let withKrampus = $state<'ja' | 'nein' | null>(null);
  let website = $state('');

  let errors = $state<Partial<Record<FieldName, string>>>({});
  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  let slotNotice = $state<string | null>(null);
  let submitted = $state<{ email: string; slot: NikolausSlot } | null>(null);

  const slots = $derived(nikolausStore.data ?? []);

  const days = $derived.by(() => {
    const byDate: Array<{ date: string; slots: NikolausSlot[]; free: number }> = [];
    for (const slot of slots) {
      let day = byDate.find((d) => d.date === slot.date);
      if (!day) {
        day = { date: slot.date, slots: [], free: 0 };
        byDate.push(day);
      }
      day.slots.push(slot);
      if (slot.available > 0) day.free += 1;
    }
    return byDate;
  });

  const activeDay = $derived(days.find((d) => d.date === selectedDate) ?? days[0]);
  const chosenSlot = $derived(slots.find((s) => s.key === selectedSlot) ?? null);

  const holdText = $derived(
    NIKOLAUS_CONFIG.pendingHoldMinutes % 60 === 0
      ? `${NIKOLAUS_CONFIG.pendingHoldMinutes / 60} Stunden`
      : `${NIKOLAUS_CONFIG.pendingHoldMinutes} Minuten`
  );

  $effect(() => {
    untrack(() => fetchNikolausSlots());
    const interval = setInterval(() => {
      if (!submitted && document.visibilityState === 'visible') refreshSlots();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  });

  async function refreshSlots(): Promise<void> {
    await fetchNikolausSlots(true);
    const current = nikolausStore.data?.find((s) => s.key === selectedSlot);
    if (selectedSlot && (!current || current.available === 0)) {
      selectedSlot = null;
      slotNotice =
        'Der gewählte Termin ist inzwischen leider vergeben. Bitte wählen Sie einen anderen Termin.';
    }
  }

  function selectDay(date: string): void {
    selectedDate = date;
  }

  function selectSlot(key: string): void {
    selectedSlot = key;
    slotNotice = null;
    clearError('slot');
  }

  function clearError(name: FieldName): void {
    if (errors[name]) errors = { ...errors, [name]: undefined };
  }

  function validate(): Partial<Record<FieldName, string>> {
    const result: Partial<Record<FieldName, string>> = {};
    if (!selectedSlot) result.slot = 'Bitte wählen Sie einen Termin aus.';
    if (!familyName.trim()) result.familyName = 'Bitte geben Sie Ihren Familiennamen an.';
    if (!EMAIL_PATTERN.test(email.trim()))
      result.email = 'Bitte geben Sie eine gültige E-Mail-Adresse an.';
    if (!PHONE_PATTERN.test(phone.trim()))
      result.phone = 'Bitte geben Sie eine gültige Telefonnummer an (z. B. 0171 1234567).';
    if (withKrampus === null)
      result.withKrampus = 'Bitte geben Sie an, ob der Krampus mit reinkommen darf.';
    return result;
  }

  function focusFirstError(result: Partial<Record<FieldName, string>>): void {
    const order: FieldName[] = ['slot', 'familyName', 'email', 'phone', 'withKrampus'];
    const first = order.find((name) => result[name]);
    if (!first) return;
    const target =
      first === 'slot'
        ? document.querySelector<HTMLElement>('#nikolaus-slots input:not(:disabled)')
        : first === 'withKrampus'
          ? document.querySelector<HTMLElement>('input[name="nikolaus-krampus"]')
          : document.getElementById(`nikolaus-${first}`);
    target?.focus();
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    submitError = null;
    const result = validate();
    errors = result;
    if (Object.keys(result).length > 0) {
      focusFirstError(result);
      return;
    }

    const slot = chosenSlot;
    if (!slot) return;

    const request: NikolausBookingRequest = {
      familyName: familyName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      slot: slot.key,
      withKrampus: withKrampus === 'ja',
      website,
    };

    submitting = true;
    try {
      await postApi<NikolausBookingCreated>('/nikolaus/bookings', request);
      submitted = { email: request.email, slot };
      fetchNikolausSlots(true);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'SLOT_FULL') {
        selectedSlot = null;
        slotNotice = error.message;
        await fetchNikolausSlots(true);
        document.getElementById('nikolaus-slot-heading')?.scrollIntoView({ behavior: 'smooth' });
      } else if (error instanceof ApiError && error.status < 500 && error.code) {
        submitError = error.message;
      } else if (error instanceof ApiError && error.code === 'MAIL_FAILED') {
        submitError = error.message;
      } else {
        submitError =
          'Die Anmeldung konnte leider nicht gespeichert werden. Bitte versuchen Sie es später erneut.';
      }
    } finally {
      submitting = false;
    }
  }

  function inputClass(hasError: boolean): string {
    return [
      'mt-1 block w-full rounded-md border bg-white px-3 py-2.5 text-base text-neutral-900 shadow-sm',
      'focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)]',
      hasError ? 'border-[var(--color-dpsg-red)]' : 'border-neutral-300',
    ].join(' ');
  }
</script>

{#if submitted}
  <div
    class="surface p-6 md:p-8 border-l-4! border-l-[var(--color-dpsg-pfadfinder)]!"
    role="status"
    aria-live="polite"
  >
    <p class="text-4xl" aria-hidden="true">📬</p>
    <h3 class="mt-3 font-serif text-2xl font-semibold text-brand-900">Fast geschafft!</h3>
    <p class="mt-3 text-neutral-800 leading-relaxed">
      Wir haben Ihnen eine E-Mail an <strong>{submitted.email}</strong> geschickt. Ihr Termin am
      <strong>{formatNikolausDate(submitted.slot.date)}</strong> um
      <strong>{submitted.slot.time} Uhr</strong> ist für Sie reserviert.
    </p>
    <p class="mt-3 text-neutral-800 leading-relaxed">
      <strong>Bitte bestätigen Sie den Termin innerhalb von {holdText}</strong> über den Link in der E-Mail
      – erst dann ist er verbindlich gebucht. Keine E-Mail erhalten? Bitte schauen Sie auch im Spam-Ordner
      nach.
    </p>
  </div>
{:else if nikolausStore.loading}
  <div role="status" aria-live="polite" class="surface p-6">
    <span class="sr-only">Freie Termine werden geladen …</span>
    <div class="skeleton-element h-6 w-48 rounded"></div>
    <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {#each [1, 2, 3, 4, 5, 6, 7, 8] as i (i)}
        <div class="skeleton-element h-16 rounded-md"></div>
      {/each}
    </div>
  </div>
{:else if nikolausStore.error || days.length === 0}
  <article role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
    <h3 class="text-lg font-semibold text-brand-900">Termine konnten nicht geladen werden</h3>
    <p class="mt-1 text-sm text-neutral-700">
      Bitte laden Sie die Seite neu oder versuchen Sie es später erneut. Bei Problemen erreichen Sie
      uns unter <a class="underline" href="mailto:kontakt@stamm-phoenix.de"
        >kontakt@stamm-phoenix.de</a
      >.
    </p>
  </article>
{:else}
  <form class="space-y-8" novalidate onsubmit={handleSubmit}>
    <!-- Step 1: slot selection -->
    <fieldset class="surface p-5 md:p-6" aria-describedby="nikolaus-slot-hint">
      <legend class="sr-only">Termin wählen</legend>
      <h3
        id="nikolaus-slot-heading"
        class="scroll-mt-32 font-serif text-xl font-semibold text-brand-900"
      >
        1. Termin wählen
      </h3>
      <p id="nikolaus-slot-hint" class="mt-1 text-sm text-neutral-700">
        Jeder Besuch dauert maximal 30 Minuten. Bereits ausgebuchte Zeiten sind ausgegraut.
      </p>

      <div class="mt-4 flex flex-wrap gap-2" role="group" aria-label="Tag auswählen">
        {#each days as day (day.date)}
          {@const isActive = activeDay?.date === day.date}
          <button
            type="button"
            class="day-tab rounded-full border px-4 py-2 text-sm font-semibold transition"
            class:day-tab-active={isActive}
            aria-pressed={isActive}
            onclick={() => selectDay(day.date)}
          >
            {formatNikolausDate(day.date).replace(/ \d{4}$/, '')}
            <span class="ml-1 font-normal opacity-80">
              · {day.free > 0 ? `${day.free} Zeiten frei` : 'ausgebucht'}
            </span>
          </button>
        {/each}
      </div>

      {#if slotNotice}
        <p
          class="mt-4 rounded-md border border-[var(--color-dpsg-red)]/30 bg-[var(--color-dpsg-red)]/5 px-4 py-3 text-sm text-[var(--color-dpsg-red)]"
          role="alert"
        >
          {slotNotice}
        </p>
      {/if}

      {#if activeDay}
        <div
          id="nikolaus-slots"
          class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          role="radiogroup"
          aria-label={`Uhrzeiten am ${formatNikolausDate(activeDay.date)}`}
          aria-invalid={errors.slot ? 'true' : undefined}
          aria-describedby={errors.slot ? 'nikolaus-slot-error' : undefined}
        >
          {#each activeDay.slots as slot (slot.key)}
            {@const full = slot.available === 0}
            {@const checked = selectedSlot === slot.key}
            <label class="slot" class:slot-full={full} class:slot-checked={checked}>
              <input
                type="radio"
                name="nikolaus-slot"
                class="sr-only"
                value={slot.key}
                {checked}
                disabled={full}
                onchange={() => selectSlot(slot.key)}
              />
              <span class="block text-base font-semibold tabular-nums">
                {slot.time} – {slot.endTime}
              </span>
              <span class="block text-xs">
                {#if full}
                  ausgebucht
                {:else if slot.available === 1}
                  noch 1 Team frei
                {:else}
                  noch {slot.available} Teams frei
                {/if}
              </span>
            </label>
          {/each}
        </div>
      {/if}

      {#if errors.slot}
        <p id="nikolaus-slot-error" class="mt-3 text-sm text-[var(--color-dpsg-red)]">
          {errors.slot}
        </p>
      {/if}
    </fieldset>

    <!-- Step 2: contact data -->
    <fieldset class="surface p-5 md:p-6">
      <legend class="sr-only">Ihre Angaben</legend>
      <h3 class="font-serif text-xl font-semibold text-brand-900">2. Ihre Angaben</h3>
      <p class="mt-1 text-sm text-neutral-700">Alle Felder sind Pflichtfelder.</p>

      <div class="mt-5 grid gap-5 md:grid-cols-2">
        <div class="md:col-span-2">
          <label for="nikolaus-familyName" class="text-sm font-semibold text-brand-900">
            Familienname
          </label>
          <input
            id="nikolaus-familyName"
            type="text"
            autocomplete="family-name"
            maxlength="100"
            required
            bind:value={familyName}
            oninput={() => clearError('familyName')}
            class={inputClass(!!errors.familyName)}
            aria-invalid={errors.familyName ? 'true' : undefined}
            aria-describedby={errors.familyName ? 'nikolaus-familyName-error' : undefined}
          />
          {#if errors.familyName}
            <p id="nikolaus-familyName-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
              {errors.familyName}
            </p>
          {/if}
        </div>

        <div>
          <label for="nikolaus-email" class="text-sm font-semibold text-brand-900">E-Mail</label>
          <input
            id="nikolaus-email"
            type="email"
            autocomplete="email"
            maxlength="254"
            required
            bind:value={email}
            oninput={() => clearError('email')}
            class={inputClass(!!errors.email)}
            aria-invalid={errors.email ? 'true' : undefined}
            aria-describedby="nikolaus-email-hint{errors.email ? ' nikolaus-email-error' : ''}"
          />
          <p id="nikolaus-email-hint" class="mt-1 text-xs text-neutral-700">
            An diese Adresse schicken wir den Bestätigungslink.
          </p>
          {#if errors.email}
            <p id="nikolaus-email-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
              {errors.email}
            </p>
          {/if}
        </div>

        <div>
          <label for="nikolaus-phone" class="text-sm font-semibold text-brand-900">
            Telefon (möglichst Handynummer)
          </label>
          <input
            id="nikolaus-phone"
            type="tel"
            autocomplete="tel"
            maxlength="30"
            required
            bind:value={phone}
            oninput={() => clearError('phone')}
            class={inputClass(!!errors.phone)}
            aria-invalid={errors.phone ? 'true' : undefined}
            aria-describedby="nikolaus-phone-hint{errors.phone ? ' nikolaus-phone-error' : ''}"
          />
          <p id="nikolaus-phone-hint" class="mt-1 text-xs text-neutral-700">
            Damit wir Sie am Besuchstag erreichen können.
          </p>
          {#if errors.phone}
            <p id="nikolaus-phone-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
              {errors.phone}
            </p>
          {/if}
        </div>

        <fieldset
          class="md:col-span-2"
          aria-describedby={errors.withKrampus ? 'nikolaus-krampus-error' : undefined}
        >
          <legend class="text-sm font-semibold text-brand-900">
            Darf der Krampus mit reinkommen?
          </legend>
          <div class="mt-2 flex flex-wrap gap-3">
            <label class="choice" class:choice-checked={withKrampus === 'ja'}>
              <input
                type="radio"
                name="nikolaus-krampus"
                value="ja"
                bind:group={withKrampus}
                onchange={() => clearError('withKrampus')}
              />
              Ja, mit Krampus
            </label>
            <label class="choice" class:choice-checked={withKrampus === 'nein'}>
              <input
                type="radio"
                name="nikolaus-krampus"
                value="nein"
                bind:group={withKrampus}
                onchange={() => clearError('withKrampus')}
              />
              Nein, der Krampus bleibt draußen
            </label>
          </div>
          {#if errors.withKrampus}
            <p id="nikolaus-krampus-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
              {errors.withKrampus}
            </p>
          {/if}
        </fieldset>

        <!-- Honeypot for bots, hidden from humans and assistive technology -->
        <div class="hp" aria-hidden="true">
          <label for="nikolaus-website">Website</label>
          <input
            id="nikolaus-website"
            type="text"
            tabindex="-1"
            autocomplete="off"
            bind:value={website}
          />
        </div>
      </div>
    </fieldset>

    <!-- Step 3: submit -->
    <div class="surface-muted p-5 md:p-6 flex flex-col gap-4 md:flex-row md:items-center">
      <div class="flex-1 text-sm text-neutral-800" aria-live="polite">
        {#if chosenSlot}
          Gewählter Termin: <strong
            >{formatNikolausDate(chosenSlot.date)}, {chosenSlot.time}–{chosenSlot.endTime} Uhr</strong
          >
        {:else}
          Noch kein Termin gewählt.
        {/if}
      </div>
      <button
        type="submit"
        class="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-dpsg-red)] px-6 py-3 text-sm font-semibold text-white shadow-lift transition hover:-translate-y-[1px] disabled:cursor-wait disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900"
        disabled={submitting}
        aria-busy={submitting}
      >
        {submitting ? 'Wird gesendet …' : 'Termin verbindlich anfragen'}
      </button>
    </div>

    {#if submitError}
      <p
        class="rounded-md border border-[var(--color-dpsg-red)]/30 bg-[var(--color-dpsg-red)]/5 px-4 py-3 text-sm text-[var(--color-dpsg-red)]"
        role="alert"
      >
        {submitError}
      </p>
    {/if}
  </form>
{/if}

<style>
  .day-tab {
    border-color: var(--color-brand-200);
    color: var(--color-brand-800);
    background: white;
  }
  .day-tab:hover {
    background: var(--color-brand-50);
  }
  .day-tab-active,
  .day-tab-active:hover {
    background: var(--color-brand-800);
    border-color: var(--color-brand-800);
    color: white;
  }

  .slot {
    display: block;
    cursor: pointer;
    border-radius: 0.5rem;
    border: 2px solid var(--color-brand-200);
    background: white;
    padding: 0.75rem;
    color: var(--color-brand-900);
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      transform 0.15s ease;
  }
  .slot:hover {
    border-color: var(--color-brand-500);
    transform: translateY(-1px);
  }
  .slot:has(input:focus-visible) {
    outline: 3px solid var(--color-dpsg-red);
    outline-offset: 2px;
  }
  .slot-checked,
  .slot-checked:hover {
    border-color: var(--color-dpsg-red);
    background: var(--color-dpsg-red);
    color: white;
  }
  .slot-full,
  .slot-full:hover {
    cursor: not-allowed;
    border-style: dashed;
    border-color: var(--color-neutral-200);
    background: var(--color-neutral-100);
    color: #8a8579;
    transform: none;
  }
  .slot-full span:first-child {
    text-decoration: line-through;
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

  .hp {
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
</style>
