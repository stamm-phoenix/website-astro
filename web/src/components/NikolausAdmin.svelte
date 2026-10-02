<script lang="ts">
  import { untrack } from 'svelte';
  import { fetchNikolausOverview, nikolausAdminStore } from '../lib/nikolausAdminStore.svelte';
  import {
    countFreePlaces,
    formatShortDate,
    formatSlotKey,
    getBookingProblems,
    getOrphanedBookings,
    getOverbookedSlots,
    isActiveBooking,
  } from '../lib/nikolausAdmin';
  import type { NikolausMoveRequest, StaffNikolausBooking } from '../lib/types';
  import NikolausAdminList from './NikolausAdminList.svelte';
  import NikolausAdminMatrix from './NikolausAdminMatrix.svelte';
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
  let notice = $state<{ text: string; kind: 'success' | 'warning' } | null>(null);

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

  const stats = $derived(
    dates.map((date) => {
      const slots = data?.slots.filter((s) => s.date === date) ?? [];
      const bookings = data?.bookings.filter((b) => b.slotKey.startsWith(date)) ?? [];
      const active = bookings.filter(isActiveBooking);
      const capacity = slots.reduce((sum, s) => sum + s.capacity, 0);
      return {
        date,
        confirmed: bookings.filter((b) => b.status === 'confirmed').length,
        pending: bookings.filter((b) => b.status === 'pending').length,
        children: active.reduce((sum, b) => sum + b.childrenCount, 0),
        // Counted per slot, so an overbooked slot cannot hide free places elsewhere
        free: countFreePlaces(slots, bookings),
        capacity,
        overbooked: getOverbookedSlots(slots, bookings).length,
      };
    })
  );

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

  const loadedAtText = $derived(
    nikolausAdminStore.loadedAt
      ? new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' }).format(nikolausAdminStore.loadedAt)
      : null
  );
</script>

{#if !data && nikolausAdminStore.loading}
  <div role="status" aria-live="polite" class="surface p-6">
    <span class="sr-only">Anmeldungen werden geladen …</span>
    <div class="skeleton-element h-6 w-56 rounded"></div>
    <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
    <div class="skeleton-element mt-2 h-4 w-64 rounded"></div>
  </div>
{:else if !data}
  <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
    <h2 class="text-lg font-semibold text-brand-900">Anmeldungen konnten nicht geladen werden</h2>
    <p class="mt-1 text-sm text-neutral-700">
      Bitte versuche es erneut. Falls das Problem bleibt, melde dich ab und wieder an.
    </p>
    <button
      type="button"
      class="btn-primary mt-4"
      onclick={() => fetchNikolausOverview({ force: true })}
    >
      Erneut versuchen
    </button>
  </div>
{:else}
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
      <button
        type="button"
        class="btn-secondary px-3! py-1! text-xs!"
        onclick={() => openMove(booking)}
      >
        Verlegen<span class="sr-only"> (Familie {booking.familyName})</span>
      </button>
      <button
        type="button"
        class="btn-secondary px-3! py-1! text-xs!"
        onclick={() => (selected = booking)}
      >
        Details<span class="sr-only"> (Familie {booking.familyName})</span>
      </button>
    </li>
  {/snippet}

  <div class="space-y-6">
    <section aria-labelledby="nikolaus-stats-heading">
      <h2 id="nikolaus-stats-heading" class="sr-only">Überblick</h2>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[32rem] text-sm">
          <thead>
            <tr class="border-b-2 border-neutral-300 text-left text-neutral-700">
              <th scope="col" class="py-2 pr-4 font-semibold">Tag</th>
              <th scope="col" class="py-2 pr-4 text-right font-semibold">Bestätigt</th>
              <th scope="col" class="py-2 pr-4 text-right font-semibold">Ausstehend</th>
              <th scope="col" class="py-2 pr-4 text-right font-semibold">Frei</th>
              <th scope="col" class="py-2 text-right font-semibold">Kinder</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-neutral-200">
            {#each stats as day (day.date)}
              <tr>
                <th scope="row" class="py-3 pr-4 text-left align-top">
                  <span class="block font-serif text-lg font-semibold text-brand-900">
                    {formatShortDate(day.date)}
                  </span>
                  {#if day.overbooked > 0}
                    <span class="block text-sm font-semibold text-[var(--color-dpsg-red)]">
                      <span aria-hidden="true">⚠</span>
                      {day.overbooked}
                      {day.overbooked === 1 ? 'Termin überbucht' : 'Termine überbucht'}
                    </span>
                  {/if}
                </th>
                <td
                  class="py-3 pr-4 text-right align-top text-xl font-semibold tabular-nums text-[var(--color-dpsg-pfadfinder)]"
                >
                  {day.confirmed}
                </td>
                <td
                  class="py-3 pr-4 text-right align-top text-xl font-semibold tabular-nums text-[#8a4a00]"
                >
                  {day.pending}
                </td>
                <td
                  class="py-3 pr-4 text-right align-top text-xl font-semibold tabular-nums text-brand-900"
                >
                  {day.free}<span class="text-sm font-normal text-neutral-700">/{day.capacity}</span
                  >
                </td>
                <td
                  class="py-3 text-right align-top text-xl font-semibold tabular-nums text-brand-900"
                >
                  {day.children}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <StatusNotice message={notice?.text ?? null} kind={notice?.kind} />

    {#if overbooked.length > 0 || orphaned.length > 0}
      <section
        aria-labelledby="nikolaus-problems-heading"
        class="border-l-4 border-[var(--color-dpsg-red)] py-1 pl-4 text-sm text-neutral-900"
      >
        <h2 id="nikolaus-problems-heading" class="font-semibold text-[var(--color-dpsg-red)]">
          <span aria-hidden="true">⚠</span> Termine, die geklärt werden müssen
        </h2>
        <p class="mt-1 text-neutral-800">
          Bitte mit den Familien Kontakt aufnehmen und Buchungen auf einen freien Termin verlegen.
        </p>
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
      <div
        class="flex flex-wrap gap-x-5 border-b border-neutral-200"
        role="group"
        aria-label="Ansicht wählen"
      >
        {#each VIEWS as option (option.key)}
          <button
            type="button"
            aria-pressed={view === option.key}
            onclick={() => selectView(option.key)}
            class="-mb-px min-h-11 border-b-2 border-transparent px-1 py-2 text-sm font-semibold text-neutral-700 hover:text-brand-900 aria-[pressed=true]:border-[var(--color-dpsg-red)] aria-[pressed=true]:text-brand-900"
          >
            {option.label}
          </button>
        {/each}
      </div>

      <div class="flex items-center gap-3 text-sm text-neutral-700">
        {#if loadedAtText}
          <span>Stand: {loadedAtText} Uhr</span>
        {/if}
        <button
          type="button"
          class="btn-secondary"
          disabled={nikolausAdminStore.loading}
          onclick={() => fetchNikolausOverview({ force: true })}
        >
          {nikolausAdminStore.loading ? 'Lädt …' : 'Neu laden'}
        </button>
      </div>
    </div>

    {#if nikolausAdminStore.error}
      <p role="alert" class="text-sm text-[var(--color-dpsg-red)]">
        Neu laden fehlgeschlagen – angezeigt wird der letzte Stand.
      </p>
    {/if}

    {#if view === 'matrix'}
      <p class="text-sm text-neutral-700">
        Tipp: Buchungen per Drag-and-drop auf einen freien Platz ziehen, um sie zu verlegen. Ohne
        Maus geht es über „Termin verlegen“ in den Details.
      </p>
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
      />
    {/if}
  </div>
{/if}

<NikolausAdminDetails
  booking={selected}
  problem={selected ? problems[selected.id] : undefined}
  onclose={() => (selected = null)}
  onmessage={openMessage}
  onmove={(booking) => openMove(booking)}
  oncancel={openCancel}
  {tagSuggestions}
  ontagssaved={(booking) => {
    const bookings = nikolausAdminStore.data?.bookings;
    const index = bookings?.findIndex((b) => b.id === booking.id) ?? -1;
    if (bookings && index >= 0) bookings[index] = booking;
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
