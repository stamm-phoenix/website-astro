<script lang="ts">
  import type { Notice } from '../lib/status';
  import { formatClock } from '../lib/format';
  import ReloadAction from './ui/ReloadAction.svelte';
  import FilterTabs from './ui/FilterTabs.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import LoadState from './ui/LoadState.svelte';
  import { untrack } from 'svelte';
  import {
    fetchNikolausOverview,
    nikolausAdminStore,
    replaceNikolausBooking,
  } from '../lib/nikolausAdminStore.svelte';
  import {
    ACTIVE_STATUSES,
    STATUS_LABEL,
    formatSlotKey,
    getBookingProblems,
    getOrphanedBookings,
    getOverbookedSlots,
    isActiveBooking,
  } from '../lib/nikolausAdmin';
  import type { NikolausMoveRequest, StaffNikolausBooking } from '../lib/types';
  import NikolausAdminList from './NikolausAdminList.svelte';
  import NikolausAdminMatrix from './NikolausAdminMatrix.svelte';
  import AdminDayOverview from './nikolaus/AdminDayOverview.svelte';
  import PdfDownloadButton from './ui/PdfDownloadButton.svelte';
  import NikolausAdminDetails from './NikolausAdminDetails.svelte';
  import NikolausMessageDialog from './NikolausMessageDialog.svelte';
  import NikolausRescheduleDialog from './NikolausRescheduleDialog.svelte';
  import NikolausCancelDialog from './NikolausCancelDialog.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';

  type View = 'liste' | 'matrix';

  const VIEWS: { key: View; label: string }[] = [
    { key: 'liste', label: 'Liste' },
    { key: 'matrix', label: 'Matrix' },
  ];

  let view = $state<View>('liste');
  let selected = $state<StaffNikolausBooking | null>(null);
  /** Booking whose family is being written to. */
  let messageTo = $state<StaffNikolausBooking | null>(null);
  let notice = $state<Notice | null>(null);

  let moveRequest = $state<NikolausMoveRequest | null>(null);
  let cancelBooking = $state<StaffNikolausBooking | null>(null);

  function openCancel(booking: StaffNikolausBooking): void {
    selected = null;
    cancelBooking = booking;
  }

  function openMove(booking: StaffNikolausBooking, target?: string): void {
    selected = null;
    moveRequest = { booking, target };
  }

  function openMessage(booking: StaffNikolausBooking): void {
    // Close the details first so there is only one modal dialog at a time
    selected = null;
    messageTo = booking;
  }

  const data = $derived(nikolausAdminStore.data);
  const dates = $derived(data ? [...new Set(data.slots.map((s) => s.date))].sort() : []);

  /** Active bookings whose slot is not part of the current configuration. */
  const orphaned = $derived(data ? getOrphanedBookings(data.slots, data.bookings) : []);
  /** Slots with more active bookings than teams, e.g. after the number of teams was reduced. */
  const overbooked = $derived(data ? getOverbookedSlots(data.slots, data.bookings) : []);
  const problems = $derived(data ? getBookingProblems(data.slots, data.bookings) : {});
  /** Tags in use on any booking, offered while typing. */
  const tagSuggestions = $derived(
    [...new Set((data?.bookings ?? []).flatMap((b) => b.internalTags))].sort((a, b) =>
      a.localeCompare(b, 'de')
    )
  );

  $effect(() => {
    untrack(() => {
      const param = new URLSearchParams(window.location.search).get('ansicht');
      if (param === 'matrix' || param === 'liste') view = param;
      fetchNikolausOverview();
    });
  });

  function selectView(next: View): void {
    view = next;
    const url = new URL(window.location.href);
    url.searchParams.set('ansicht', next);
    history.replaceState(history.state, '', url);
  }

  /** What the list shows with its filters; the matrix shows all active bookings. */
  let listShown = $state<{ bookings: StaffNikolausBooking[]; filters: string[] }>({
    bookings: [],
    filters: [],
  });

  async function createPdf(): Promise<void> {
    const shown =
      view === 'liste'
        ? listShown
        : {
            bookings: (data?.bookings ?? []).filter(isActiveBooking),
            filters: [ACTIVE_STATUSES.map((status) => STATUS_LABEL[status]).join(', ')],
          };
    const pdf = {
      ...shown,
      problems,
      fileName: `nikolaus-anmeldungen-${new Date().toLocaleDateString('sv-SE')}.pdf`,
    };
    const { downloadAnmeldungenPdf } = await import('../lib/nikolausAnmeldungenPdf');
    await downloadAnmeldungenPdf(pdf);
  }

  const loadedAtText = $derived(
    nikolausAdminStore.loadedAt ? formatClock(nikolausAdminStore.loadedAt) : null
  );
</script>

{#snippet problemBooking(booking: StaffNikolausBooking)}
  <li class="flex flex-wrap items-center gap-2">
    <span>
      Familie {booking.familyName}
      <span class="text-neutral-700"
        >({formatSlotKey(booking.slotKey)}, {booking.status === 'confirmed'
          ? 'bestätigt'
          : 'ausstehend'})</span
      >
    </span>
    <ActionButton
      variant="secondary"
      type="button"
      class="px-3! py-1! text-xs!"
      onclick={() => openMove(booking)}
    >
      Verlegen<span class="sr-only"> (Familie {booking.familyName})</span>
    </ActionButton>
    <ActionButton
      variant="secondary"
      type="button"
      class="px-3! py-1! text-xs!"
      onclick={() => (selected = booking)}
    >
      Details<span class="sr-only"> (Familie {booking.familyName})</span>
    </ActionButton>
  </li>
{/snippet}

<LoadState
  data={nikolausAdminStore.data}
  loading={nikolausAdminStore.loading}
  error={nikolausAdminStore.error}
  loadingText="Anmeldungen werden geladen …"
  onretry={() => void fetchNikolausOverview({ force: true })}
>
  {#snippet skeleton()}
    <div class="surface p-6">
      <div class="skeleton-element h-6 w-56 rounded"></div>
      <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
      <div class="skeleton-element mt-2 h-4 w-64 rounded"></div>
    </div>
  {/snippet}
  {#snippet children(data)}
    <div class="space-y-6">
      <AdminDayOverview slots={data.slots} bookings={data.bookings} {dates} />

      <StatusNotice message={notice?.text ?? null} kind={notice?.kind} popup />

      {#if overbooked.length > 0 || orphaned.length > 0}
        <section
          aria-labelledby="nikolaus-problems-heading"
          class="border-l-4 border-danger py-1 pl-4 text-sm text-neutral-900"
        >
          <h2 id="nikolaus-problems-heading" class="font-semibold text-danger">
            <span aria-hidden="true">⚠</span> Termine, die geklärt werden müssen
          </h2>
          <ul class="mt-3 space-y-3">
            {#each overbooked as entry (entry.slot.key)}
              <li>
                <p class="font-semibold">
                  {formatSlotKey(entry.slot.key)}: {entry.bookings.length} Buchungen, aber
                  {entry.slot.capacity === 1 ? 'nur 1 Team' : `nur ${entry.slot.capacity} Teams`}
                </p>
                <ul class="mt-1 space-y-1">
                  {#each entry.bookings as booking (booking.id)}
                    {@render problemBooking(booking)}
                  {/each}
                </ul>
              </li>
            {/each}
            {#if orphaned.length > 0}
              <li>
                <p class="font-semibold">Termine, die nicht mehr angeboten werden</p>
                <ul class="mt-1 space-y-1">
                  {#each orphaned as booking (booking.id)}
                    {@render problemBooking(booking)}
                  {/each}
                </ul>
              </li>
            {/if}
          </ul>
        </section>
      {/if}

      <div class="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs
          label="Ansicht wählen"
          variant="segmented"
          options={VIEWS.map((option) => ({ value: option.key, label: option.label }))}
          value={view}
          onselect={selectView}
          class="border-b border-neutral-200"
        />

        <div class="flex items-center gap-3 text-sm text-neutral-700">
          {#if loadedAtText}
            <span>Stand: {loadedAtText} Uhr</span>
          {/if}
          <ReloadAction
            type="button"
            disabled={nikolausAdminStore.loading}
            onclick={() => fetchNikolausOverview({ force: true })}
          >
            {nikolausAdminStore.loading ? 'Lädt …' : 'Neu laden'}
          </ReloadAction>
          <PdfDownloadButton
            download={createPdf}
            disabled={view === 'liste' && listShown.bookings.length === 0}
            errorText="Das PDF der Anmeldungen konnte nicht erstellt werden. Versuch es noch einmal."
            onresult={(kind, text) => (notice = { kind, text })}
          />
        </div>
      </div>

      {#if view === 'matrix'}
        <NikolausAdminMatrix
          slots={data.slots}
          bookings={data.bookings}
          {dates}
          onselect={(booking) => (selected = booking)}
          onmove={openMove}
        />
      {:else}
        <NikolausAdminList
          bookings={data.bookings}
          {dates}
          {problems}
          onselect={(booking) => (selected = booking)}
          onshown={(shown) => (listShown = shown)}
        />
      {/if}
    </div>
  {/snippet}
</LoadState>

<NikolausAdminDetails
  booking={selected}
  problem={selected ? problems[selected.id] : undefined}
  onclose={() => (selected = null)}
  onmessage={openMessage}
  onmove={(booking) => openMove(booking)}
  oncancel={openCancel}
  {tagSuggestions}
  ontagssaved={(booking) => {
    replaceNikolausBooking(booking);
    if (selected?.id === booking.id) selected = booking;
  }}
/>

<NikolausCancelDialog
  booking={cancelBooking}
  onclose={() => (cancelBooking = null)}
  onstale={() => fetchNikolausOverview({ force: true })}
  ondone={async (booking, mailSent) => {
    cancelBooking = null;
    notice = mailSent
      ? {
          text: `Termin von Familie ${booking.familyName} (${formatSlotKey(booking.slotKey)}) abgesagt, E-Mail gesendet.`,
          kind: 'success',
        }
      : {
          text: `Termin von Familie ${booking.familyName} (${formatSlotKey(booking.slotKey)}) abgesagt – die E-Mail konnte aber nicht gesendet werden. Bitte informiere die Familie selbst.`,
          kind: 'warning',
        };
    await fetchNikolausOverview({ force: true });
  }}
/>

<NikolausRescheduleDialog
  request={moveRequest}
  slots={data?.slots ?? []}
  bookings={data?.bookings ?? []}
  onclose={() => (moveRequest = null)}
  onstale={() => fetchNikolausOverview({ force: true })}
  ondone={async (result) => {
    moveRequest = null;
    notice = result.mailSent
      ? {
          text: `Familie ${result.booking.familyName} auf ${formatSlotKey(result.target)} verlegt, E-Mail gesendet.`,
          kind: 'success',
        }
      : {
          text: `Familie ${result.booking.familyName} auf ${formatSlotKey(result.target)} verlegt – die E-Mail konnte aber nicht gesendet werden. Bitte informiere die Familie selbst.`,
          kind: 'warning',
        };
    await fetchNikolausOverview({ force: true });
  }}
/>

<NikolausMessageDialog
  booking={messageTo}
  onclose={() => (messageTo = null)}
  onsent={(booking) => {
    messageTo = null;
    notice = { text: `Nachricht an Familie ${booking.familyName} gesendet.`, kind: 'success' };
  }}
/>
