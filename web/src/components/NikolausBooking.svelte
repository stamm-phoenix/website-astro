<script lang="ts">
  import { untrack } from 'svelte';
  import { nikolausStore, fetchNikolausSlots } from '../lib/nikolausStore.svelte';
  import { ApiError, postApi } from '../lib/api';
  import {
    formatNikolausDate,
    NIKOLAUS_CONFIG,
    validateNikolausDetails,
  } from '../lib/nikolausConfig';
  import type { NikolausDetailsField } from '../lib/nikolausConfig';
  import type { NikolausBookingCreated, NikolausBookingRequest, NikolausSlot } from '../lib/types';
  import NikolausSlotPicker from './NikolausSlotPicker.svelte';
  import NikolausDetailsFields from './NikolausDetailsFields.svelte';

  const ID_PREFIX = 'nikolaus';
  const REFRESH_INTERVAL_MS = 60_000;

  let selectedSlot = $state<string | null>(null);
  let familyName = $state('');
  let email = $state('');
  let phone = $state('');
  let withKrampus = $state<'ja' | 'nein' | null>(null);
  let website = $state('');

  let slotError = $state<string | undefined>(undefined);
  let errors = $state<Partial<Record<NikolausDetailsField, string>>>({});
  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  let slotNotice = $state<string | null>(null);
  let submitted = $state<{ email: string; slot: NikolausSlot } | null>(null);

  const slots = $derived(nikolausStore.data ?? []);
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

  function handleSlotSelect(): void {
    slotNotice = null;
    slotError = undefined;
  }

  function focusFirstError(): void {
    const order: NikolausDetailsField[] = ['familyName', 'email', 'phone', 'withKrampus'];
    const first = order.find((name) => errors[name]);
    const target = slotError
      ? document.querySelector<HTMLElement>(`#${ID_PREFIX}-slots input:not(:disabled)`)
      : first === 'withKrampus'
        ? document.querySelector<HTMLElement>(`input[name="${ID_PREFIX}-krampus"]`)
        : first
          ? document.getElementById(`${ID_PREFIX}-${first}`)
          : null;
    target?.focus();
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    submitError = null;
    const validation = validateNikolausDetails({
      familyName,
      email,
      phone,
      withKrampus: withKrampus === null ? undefined : withKrampus === 'ja',
    });
    errors = validation.errors;
    slotError = chosenSlot ? undefined : 'Bitte wählen Sie einen Termin aus.';
    if (!validation.details || !chosenSlot) {
      focusFirstError();
      return;
    }

    const slot = chosenSlot;
    const request: NikolausBookingRequest = { ...validation.details, slot: slot.key, website };

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
      } else if (error instanceof ApiError && error.code) {
        submitError = error.message;
      } else {
        submitError =
          'Die Anmeldung konnte leider nicht gespeichert werden. Bitte versuchen Sie es später erneut.';
      }
    } finally {
      submitting = false;
    }
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
{:else if nikolausStore.error || slots.length === 0}
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

      <NikolausSlotPicker
        {slots}
        bind:selected={selectedSlot}
        idPrefix={ID_PREFIX}
        error={slotError}
        notice={slotNotice}
        onselect={handleSlotSelect}
      />
    </fieldset>

    <!-- Step 2: contact data -->
    <fieldset class="surface p-5 md:p-6">
      <legend class="sr-only">Ihre Angaben</legend>
      <h3 class="font-serif text-xl font-semibold text-brand-900">2. Ihre Angaben</h3>
      <p class="mt-1 text-sm text-neutral-700">Alle Felder sind Pflichtfelder.</p>

      <div class="mt-5">
        <NikolausDetailsFields
          bind:familyName
          bind:email
          bind:phone
          bind:withKrampus
          bind:errors
          idPrefix={ID_PREFIX}
        />

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
  .hp {
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
</style>
