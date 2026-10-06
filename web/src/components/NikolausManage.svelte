<script lang="ts">
  import ActionButton from './ui/ActionButton.svelte';
  import { tick, untrack } from 'svelte';
  import { ApiError, postApi } from '../lib/api';
  import { readNikolausManageToken } from '../lib/nikolausManageLink';
  import { formatNikolausDate } from '../lib/nikolausConfig';
  import {
    detailsFormFromBooking,
    emptyDetailsForm,
    validateDetailsForm,
  } from '../lib/nikolausForm';
  import type { NikolausDetailsField } from '../lib/nikolausConfig';
  import { nikolausStore, fetchNikolausSlots } from '../lib/nikolausStore.svelte';
  import type { NikolausBookingInfo } from '../lib/types';
  import NikolausSlotPicker from './NikolausSlotPicker.svelte';
  import NikolausDetailsFields from './NikolausDetailsFields.svelte';
  import NikolausAddressMap from './NikolausAddressMap.svelte';
  import NikolausVisitProgress from './NikolausVisitProgress.svelte';

  type Action = 'confirm' | 'cancel' | 'update' | 'reschedule';

  const ID_PREFIX = 'manage';
  const CONTACT_MAIL = 'kontakt@stamm-phoenix.de';

  let token = $state('');
  let booking = $state<NikolausBookingInfo | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let busy = $state<Action | null>(null);
  let success = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let confirmCancel = $state(false);
  /** Set by the visit progress once the Nikolaus was there or the visit day is over. */
  let finished = $state<'visited' | 'after' | null>(null);

  // Editing the details
  let editing = $state(false);
  let details = $state(emptyDetailsForm());
  let errors = $state<Partial<Record<NikolausDetailsField, string>>>({});

  // Choosing another slot
  let rescheduling = $state(false);
  let newSlot = $state<string | null>(null);
  let slotNotice = $state<string | null>(null);
  let loadGeneration = 0;

  const isActive = $derived(booking?.status === 'pending' || booking?.status === 'confirmed');
  const canChange = $derived(isActive && booking?.canChange === true);
  const chosenSlot = $derived(nikolausStore.data?.find((s) => s.key === newSlot) ?? null);

  $effect(() => {
    untrack(() => load());
    const onHashChange = (): void => {
      if (readNikolausManageToken() !== token) void load();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      loadGeneration++;
      window.removeEventListener('hashchange', onHashChange);
    };
  });

  async function load(): Promise<void> {
    const generation = ++loadGeneration;
    token = readNikolausManageToken();
    loading = true;
    booking = null;
    loadError = null;
    success = null;
    actionError = null;
    busy = null;
    finished = null;
    closeEditors();
    if (!token) {
      loadError =
        'Dieser Link ist unvollständig. Bitte verwenden Sie die vollständige Adresse aus der E-Mail.';
      loading = false;
      return;
    }

    try {
      const loaded = await postApi<NikolausBookingInfo>('/nikolaus/manage/lookup', { token });
      if (generation === loadGeneration) booking = loaded;
    } catch (error: unknown) {
      if (generation !== loadGeneration) return;
      loadError =
        error instanceof ApiError && error.code
          ? error.message
          : 'Die Buchung konnte nicht geladen werden. Bitte versuchen Sie es später erneut.';
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  async function run(
    action: Action,
    body: Record<string, unknown>,
    successMessage: string
  ): Promise<boolean> {
    if (busy || !booking) return false;
    const generation = loadGeneration;
    busy = action;
    actionError = null;
    success = null;
    try {
      const changed = await postApi<NikolausBookingInfo>(`/nikolaus/manage/${action}`, {
        ...body,
        token,
        etag: booking.etag,
      });
      if (generation !== loadGeneration) return false;
      booking = changed;
      success = successMessage;
      await showMessages(generation);
      return generation === loadGeneration;
    } catch (error: unknown) {
      if (generation !== loadGeneration) return false;
      await handleActionError(action, error, generation);
      return false;
    } finally {
      if (generation === loadGeneration) busy = null;
    }
  }

  /** Brings the result message into view, as the action button may be far below it. */
  async function showMessages(generation: number): Promise<void> {
    await tick();
    if (generation !== loadGeneration) return;
    document
      .getElementById('manage-messages')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function handleActionError(
    action: Action,
    error: unknown,
    generation: number
  ): Promise<void> {
    const code = error instanceof ApiError ? error.code : undefined;
    if (code === 'SLOT_FULL' && action === 'reschedule') {
      newSlot = null;
      slotNotice = (error as ApiError).message;
      await fetchNikolausSlots(true);
      return;
    }
    if (code === 'EXPIRED' && booking) {
      closeEditors();
      booking = { ...booking, status: 'expired', canChange: false };
    } else if (code === 'CANCELLED' && booking) {
      closeEditors();
      booking = { ...booking, status: 'cancelled', canChange: false };
    } else if (code === 'DEADLINE_PASSED' || code === 'ALREADY_CHANGED') {
      closeEditors();
      await refreshBooking();
    }
    if (generation !== loadGeneration) return;
    actionError =
      error instanceof ApiError && code
        ? error.message
        : 'Das hat leider nicht geklappt. Bitte versuchen Sie es später erneut.';
    await showMessages(generation);
  }

  async function refreshBooking(): Promise<void> {
    const generation = loadGeneration;
    try {
      const refreshed = await postApi<NikolausBookingInfo>('/nikolaus/manage/lookup', { token });
      if (generation === loadGeneration) booking = refreshed;
    } catch {
      // Keep the current state, the error message is shown anyway
    }
  }

  function closeEditors(): void {
    editing = false;
    rescheduling = false;
    confirmCancel = false;
  }

  function startEditing(): void {
    if (!booking) return;
    closeEditors();
    details = detailsFormFromBooking(booking);
    errors = {};
    success = null;
    actionError = null;
    editing = true;
  }

  async function saveDetails(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const validation = validateDetailsForm(details);
    errors = validation.errors;
    if (!validation.details) return;

    const emailChanged = validation.details.email.toLowerCase() !== booking?.email.toLowerCase();
    const saved = await run(
      'update',
      { ...validation.details },
      emailChanged
        ? `Ihre Angaben wurden gespeichert. Künftige E-Mails zu Ihrem Termin gehen an ${validation.details.email}.`
        : 'Ihre Angaben wurden gespeichert. Wir haben Ihnen eine Bestätigung per E-Mail geschickt.'
    );
    if (saved) editing = false;
  }

  function startRescheduling(): void {
    closeEditors();
    newSlot = null;
    slotNotice = null;
    success = null;
    actionError = null;
    rescheduling = true;
    fetchNikolausSlots(true);
  }

  async function reschedule(): Promise<void> {
    if (!newSlot) return;
    const target = chosenSlot;
    const moved = await run(
      'reschedule',
      { slot: newSlot },
      target
        ? `Ihr Termin wurde auf ${formatNikolausDate(target.date)}, ${target.time} Uhr verlegt. Wir haben Ihnen eine Bestätigung per E-Mail geschickt.`
        : 'Ihr Termin wurde verlegt.'
    );
    if (moved) {
      rescheduling = false;
      fetchNikolausSlots(true);
    }
  }

  function slotText(info: NikolausBookingInfo): string {
    return info.slot
      ? `${formatNikolausDate(info.slot.date)}, ${info.slot.time}–${info.slot.endTime} Uhr`
      : 'Termin nicht mehr verfügbar';
  }

  function formatDateTime(iso: string, withWeekday = false): string {
    return new Intl.DateTimeFormat('de-DE', {
      weekday: withWeekday ? 'long' : undefined,
      day: 'numeric',
      month: withWeekday ? 'long' : 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Berlin',
    }).format(new Date(iso));
  }
</script>

{#snippet message(text: string, kind: 'success' | 'error')}
  <p
    class={[
      'border-l-4 py-1 pl-4 text-sm font-semibold',
      kind === 'success' ? 'border-success text-success' : 'border-danger text-danger',
    ].join(' ')}
    role={kind === 'success' ? 'status' : 'alert'}
  >
    {text}
  </p>
{/snippet}

{#if loading}
  <div role="status" aria-live="polite" class="surface p-6">
    <span class="sr-only">Buchung wird geladen …</span>
    <div class="skeleton-element h-6 w-56 rounded"></div>
    <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
    <div class="skeleton-element mt-2 h-4 w-64 rounded"></div>
  </div>
{:else if loadError || !booking}
  <article role="alert" class="surface p-6 border-l-4! border-l-danger!">
    <h2 class="text-lg font-semibold text-brand-900">Buchung nicht gefunden</h2>
    <p class="mt-1 text-sm text-neutral-700">{loadError}</p>
    <p class="mt-3 text-sm">
      <a class="font-semibold text-link underline" href="/nikolaus">Zur Nikolaus-Anmeldung</a>
    </p>
  </article>
{:else}
  <div class="space-y-6">
    <!-- Status -->
    <article
      class={[
        'surface p-6 md:p-8 border-l-4!',
        booking.status === 'confirmed' ? 'border-l-success!' : 'border-l-danger!',
      ].join(' ')}
      aria-labelledby="booking-status-heading"
    >
      {#if booking.status === 'pending'}
        <h2 id="booking-status-heading" class="font-serif text-2xl font-semibold text-brand-900">
          Bitte bestätigen Sie Ihren Termin
        </h2>
        <p class="mt-2 text-neutral-800">
          Ihr Termin ist reserviert{booking.reservedUntil
            ? ` bis ${formatDateTime(booking.reservedUntil)} Uhr`
            : ''}. Erst mit Ihrer Bestätigung ist er verbindlich gebucht.
        </p>
        <ActionButton
          variant="primary"
          type="button"
          class="mt-5"
          disabled={busy !== null}
          aria-busy={busy === 'confirm'}
          onclick={() =>
            run(
              'confirm',
              {},
              'Vielen Dank – Ihr Termin ist bestätigt! Eine Bestätigung haben wir Ihnen per E-Mail geschickt.'
            )}
        >
          {busy === 'confirm' ? 'Wird bestätigt …' : 'Termin verbindlich bestätigen'}
        </ActionButton>
      {:else if booking.status === 'confirmed' && finished === 'visited'}
        <h2 id="booking-status-heading" class="font-serif text-2xl font-semibold text-brand-900">
          Der Nikolaus war bei Ihnen
        </h2>
        <p class="mt-2 text-neutral-800">Vielen Dank und eine schöne Adventszeit!</p>
      {:else if booking.status === 'confirmed' && finished === 'after'}
        <h2 id="booking-status-heading" class="font-serif text-2xl font-semibold text-brand-900">
          Vielen Dank!
        </h2>
        <p class="mt-2 text-neutral-800">
          Schön, dass Sie beim Nikolausdienst dabei waren – eine schöne Adventszeit!
        </p>
      {:else if booking.status === 'confirmed'}
        <h2 id="booking-status-heading" class="font-serif text-2xl font-semibold text-brand-900">
          Ihr Termin ist bestätigt
        </h2>
        <p class="mt-2 text-neutral-800">Der Nikolaus freut sich auf Ihren Besuch!</p>
      {:else if booking.status === 'cancelled'}
        <h2 id="booking-status-heading" class="font-serif text-2xl font-semibold text-brand-900">
          Der Termin wurde abgesagt
        </h2>
        <p class="mt-2 text-neutral-800">
          Der Termin ist wieder freigegeben. Sie können jederzeit einen neuen Termin buchen.
        </p>
      {:else}
        <h2 id="booking-status-heading" class="font-serif text-2xl font-semibold text-brand-900">
          Die Reservierung ist abgelaufen
        </h2>
        <p class="mt-2 text-neutral-800">
          Der Termin wurde nicht rechtzeitig bestätigt und ist wieder freigegeben. Bitte melden Sie
          sich erneut an.
        </p>
      {/if}

      {#if !isActive}
        <a href="/nikolaus" class="btn-primary mt-5 no-underline">Neuen Termin buchen</a>
      {/if}
    </article>

    <div id="manage-messages" aria-live="polite" class="space-y-3 scroll-mt-32">
      {#if success}{@render message(success, 'success')}{/if}
      {#if actionError}{@render message(actionError, 'error')}{/if}
    </div>

    <!-- Progress on the visit day -->
    {#if booking.status === 'confirmed' && booking.slot}
      <NikolausVisitProgress {token} date={booking.slot.date} bind:finished />
    {/if}

    <!-- Change deadline -->
    {#if isActive && booking.changeDeadline && !finished}
      {#if canChange}
        <div class="border-l-4 border-[var(--color-brand-300)] py-1 pl-4 text-sm text-brand-900">
          <p>
            Sie können Ihre Angaben ändern, den Termin verlegen oder absagen – bis
            <strong>{formatDateTime(booking.changeDeadline, true)} Uhr</strong>
            ({booking.changeDeadlineHours} Stunden vor Ihrem Termin). Danach planen unsere Teams ihre
            Touren, und Änderungen sind online nicht mehr möglich.
          </p>
        </div>
      {:else}
        <div
          class="border-l-4 border-[var(--color-neutral-300)] py-1 pl-4 text-sm text-neutral-800"
        >
          <p>
            <strong>Online-Änderungen sind nicht mehr möglich.</strong> Termine können nur bis
            {booking.changeDeadlineHours} Stunden vor Beginn online geändert oder abgesagt werden, weil
            unsere Teams ihre Touren dann bereits planen. Falls sich trotzdem etwas geändert hat, schreiben
            Sie uns bitte an
            <a class="underline" href="mailto:{CONTACT_MAIL}">{CONTACT_MAIL}</a>.
          </p>
        </div>
      {/if}
    {/if}

    <!-- Appointment -->
    <section class="surface p-5 md:p-6" aria-labelledby="manage-slot-heading">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="manage-slot-heading" class="font-serif text-xl font-semibold text-brand-900">
            Ihr Termin
          </h3>
          <p class="mt-1 font-semibold text-brand-900">{slotText(booking)}</p>
        </div>
        {#if canChange && !rescheduling}
          <ActionButton variant="secondary" type="button" onclick={startRescheduling}>
            Anderen Termin wählen
          </ActionButton>
        {/if}
      </div>

      {#if rescheduling}
        <div class="mt-4 border-t border-[var(--color-neutral-200)] pt-4">
          <p class="text-sm text-neutral-700">
            Wählen Sie einen neuen Termin. Ihr bisheriger Termin bleibt bestehen, bis die Umbuchung
            geklappt hat.
          </p>
          {#if nikolausStore.loading}
            <div role="status" aria-live="polite" class="mt-4 text-sm text-neutral-700">
              Freie Termine werden geladen …
            </div>
          {:else if nikolausStore.error || !nikolausStore.data}
            <div class="mt-4">
              {@render message(
                'Die freien Termine konnten nicht geladen werden. Bitte versuchen Sie es später erneut.',
                'error'
              )}
            </div>
          {:else}
            <NikolausSlotPicker
              slots={nikolausStore.data}
              bind:selected={newSlot}
              currentSlot={booking.slot?.key ?? null}
              idPrefix={ID_PREFIX}
              notice={slotNotice}
              onselect={() => (slotNotice = null)}
            />
          {/if}
          <div class="mt-5 flex flex-wrap gap-3">
            <ActionButton
              variant="primary"
              type="button"
              disabled={!newSlot || busy !== null}
              aria-busy={busy === 'reschedule'}
              onclick={reschedule}
            >
              {#if busy === 'reschedule'}
                Wird umgebucht …
              {:else if chosenSlot}
                Umbuchen auf {formatNikolausDate(chosenSlot.date).replace(/ \d{4}$/, '')},
                {chosenSlot.time} Uhr
              {:else}
                Bitte neuen Termin wählen
              {/if}
            </ActionButton>
            <ActionButton
              variant="secondary"
              type="button"
              disabled={busy !== null}
              onclick={() => (rescheduling = false)}
            >
              Abbrechen
            </ActionButton>
          </div>
        </div>
      {/if}
    </section>

    <!-- Details -->
    <section class="surface p-5 md:p-6" aria-labelledby="manage-details-heading">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <h3 id="manage-details-heading" class="font-serif text-xl font-semibold text-brand-900">
          Ihre Angaben
        </h3>
        {#if canChange && !editing}
          <ActionButton variant="secondary" type="button" onclick={startEditing}
            >Bearbeiten</ActionButton
          >
        {/if}
      </div>

      {#if editing}
        <form class="mt-4" novalidate onsubmit={saveDetails}>
          <NikolausDetailsFields
            bind:details
            bind:errors
            idPrefix={ID_PREFIX}
            emailHint="Wenn Sie die E-Mail-Adresse ändern, schicken wir einen Hinweis auch an die bisherige Adresse."
          />
          <div class="mt-5 flex flex-wrap gap-3">
            <ActionButton
              variant="primary"
              type="submit"
              disabled={busy !== null}
              aria-busy={busy === 'update'}
            >
              {busy === 'update' ? 'Wird gespeichert …' : 'Änderungen speichern'}
            </ActionButton>
            <ActionButton
              variant="secondary"
              type="button"
              disabled={busy !== null}
              onclick={() => (editing = false)}
            >
              Abbrechen
            </ActionButton>
          </div>
        </form>
      {:else}
        <div class="mt-4 grid gap-6 md:grid-cols-2">
          <dl class="details-list">
            <dt>Familie</dt>
            <dd>{booking.familyName}</dd>
            <dt>E-Mail</dt>
            <dd class="break-all">{booking.email}</dd>
            <dt>Telefon</dt>
            <dd>{booking.phone}</dd>
            <dt>Adresse</dt>
            <dd>{booking.street}<br />{booking.postalCode} {booking.city}</dd>
            {#if booking.addressNotes}
              <dt>Hinweise zur Adresse</dt>
              <dd class="whitespace-pre-line">{booking.addressNotes}</dd>
            {/if}
            <dt>Kinder</dt>
            <dd>{booking.childrenCount}</dd>
            <dt>Krampus</dt>
            <dd>{booking.withKrampus ? 'darf mit reinkommen' : 'bleibt draußen'}</dd>
            <dt>Versteck</dt>
            <dd class="whitespace-pre-line">{booking.hidingPlace}</dd>
            {#if booking.notes}
              <dt>Bemerkungen</dt>
              <dd class="whitespace-pre-line">{booking.notes}</dd>
            {/if}
          </dl>
          {#if booking.location}
            <div>
              <NikolausAddressMap
                street={booking.street}
                postalCode={booking.postalCode}
                city={booking.city}
                location={booking.location}
              />
              {#if booking.location.approximate}
                <p class="mt-2 text-xs text-neutral-700">
                  Die genaue Adresse war auf der Karte nicht zu finden, der Punkt zeigt ungefähr
                  Ihren Ort.
                </p>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <!-- Cancel -->
    {#if canChange}
      <section class="surface p-5 md:p-6" aria-labelledby="manage-cancel-heading">
        <h3 id="manage-cancel-heading" class="font-serif text-xl font-semibold text-brand-900">
          Termin absagen
        </h3>
        <p class="mt-1 text-sm text-neutral-700">
          Sie können nicht? Dann geben Sie den Termin bitte frei, damit eine andere Familie ihn
          buchen kann.
        </p>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          {#if confirmCancel}
            <span class="text-sm text-neutral-800">Wirklich absagen?</span>
            <ActionButton
              variant="danger"
              type="button"
              disabled={busy !== null}
              aria-busy={busy === 'cancel'}
              onclick={async () => {
                if (await run('cancel', {}, 'Ihr Termin wurde abgesagt.')) closeEditors();
              }}
            >
              {busy === 'cancel' ? 'Wird abgesagt …' : 'Ja, Termin absagen'}
            </ActionButton>
            <ActionButton
              variant="secondary"
              type="button"
              disabled={busy !== null}
              onclick={() => (confirmCancel = false)}
            >
              Nein, behalten
            </ActionButton>
          {:else}
            <ActionButton
              variant="secondary"
              type="button"
              disabled={busy !== null}
              onclick={() => (confirmCancel = true)}
            >
              Termin absagen
            </ActionButton>
          {/if}
        </div>
      </section>
    {/if}
  </div>
{/if}

<style>
  .details-list {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 1.5rem;
    font-size: 0.875rem;
    align-content: start;
  }
  .details-list dt,
  .details-list dd {
    padding: 0.5rem 0;
    border-top: 1px solid var(--color-neutral-200);
  }
  .details-list dt {
    color: var(--color-neutral-700);
  }
  .details-list dd {
    color: var(--color-neutral-900);
  }
</style>
