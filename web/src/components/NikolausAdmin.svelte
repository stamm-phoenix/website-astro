<script lang="ts">
  import { untrack } from 'svelte';
  import { fetchNikolausOverview, nikolausAdminStore } from '../lib/nikolausAdminStore.svelte';
  import { formatShortDate, formatSlotKey, isActiveBooking } from '../lib/nikolausAdmin';
  import type { StaffNikolausBooking } from '../lib/types';
  import NikolausAdminList from './NikolausAdminList.svelte';
  import NikolausAdminMatrix from './NikolausAdminMatrix.svelte';
  import NikolausAdminDetails from './NikolausAdminDetails.svelte';
  import NikolausMessageDialog from './NikolausMessageDialog.svelte';

  type View = 'liste' | 'matrix';

  const VIEWS: { key: View; label: string }[] = [
    { key: 'liste', label: 'Liste' },
    { key: 'matrix', label: 'Matrix' },
  ];

  let view = $state<View>('liste');
  let selected = $state<StaffNikolausBooking | null>(null);
  /** Booking whose family is being written to. */
  let messageTo = $state<StaffNikolausBooking | null>(null);
  let notice = $state<string | null>(null);

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
      const taken = slots.reduce((sum, s) => sum + s.taken, 0);
      return {
        date,
        confirmed: bookings.filter((b) => b.status === 'confirmed').length,
        pending: bookings.filter((b) => b.status === 'pending').length,
        children: active.reduce((sum, b) => sum + b.childrenCount, 0),
        free: Math.max(0, capacity - taken),
        capacity,
      };
    })
  );

  /** Active bookings whose slot is not part of the current configuration. */
  const orphaned = $derived(
    data
      ? data.bookings.filter(
          (b) => isActiveBooking(b) && !data.slots.some((s) => s.key === b.slotKey)
        )
      : []
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
      class="mt-4 rounded-full bg-[var(--color-dpsg-red)] px-5 py-2 text-sm font-semibold text-white"
      onclick={() => fetchNikolausOverview({ force: true })}
    >
      Erneut versuchen
    </button>
  </div>
{:else}
  <div class="space-y-6">
    <section aria-labelledby="nikolaus-stats-heading">
      <h2 id="nikolaus-stats-heading" class="sr-only">Überblick</h2>
      <ul class="grid gap-4 sm:grid-cols-2">
        {#each stats as day (day.date)}
          <li class="surface p-4 md:p-5">
            <p class="font-serif text-lg font-semibold text-brand-900">
              {formatShortDate(day.date)}
            </p>
            <dl class="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt class="text-neutral-700">Bestätigt</dt>
                <dd class="text-2xl font-semibold tabular-nums text-[var(--color-dpsg-pfadfinder)]">
                  {day.confirmed}
                </dd>
              </div>
              <div>
                <dt class="text-neutral-700">Ausstehend</dt>
                <dd class="text-2xl font-semibold tabular-nums text-[#8a4a00]">{day.pending}</dd>
              </div>
              <div>
                <dt class="text-neutral-700">Frei</dt>
                <dd class="text-2xl font-semibold tabular-nums text-brand-900">
                  {day.free}<span class="text-sm font-normal text-neutral-700">/{day.capacity}</span
                  >
                </dd>
              </div>
              <div>
                <dt class="text-neutral-700">Kinder</dt>
                <dd class="text-2xl font-semibold tabular-nums text-brand-900">{day.children}</dd>
              </div>
            </dl>
          </li>
        {/each}
      </ul>
    </section>

    <p
      role="status"
      aria-live="polite"
      class="text-sm text-[var(--color-dpsg-pfadfinder)]"
    >
      {notice ?? ''}
    </p>

    {#if orphaned.length > 0}
      <div
        role="alert"
        class="rounded-md border border-[#e5b8bd] bg-[#f7e3e5] px-4 py-3 text-sm text-[var(--color-dpsg-red)]"
      >
        <p class="font-semibold">
          {orphaned.length}
          {orphaned.length === 1 ? 'aktive Anmeldung liegt' : 'aktive Anmeldungen liegen'} außerhalb der
          konfigurierten Termine:
        </p>
        <ul class="mt-1 list-disc pl-5">
          {#each orphaned as booking (booking.id)}
            <li>
              <button type="button" class="underline" onclick={() => (selected = booking)}>
                Familie {booking.familyName} ({formatSlotKey(booking.slotKey)})
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div
        class="inline-flex rounded-full border border-[var(--color-brand-200)] bg-white p-1"
        role="group"
        aria-label="Ansicht wählen"
      >
        {#each VIEWS as option (option.key)}
          <button
            type="button"
            aria-pressed={view === option.key}
            onclick={() => selectView(option.key)}
            class="rounded-full px-4 py-1.5 text-sm font-semibold text-brand-800 aria-[pressed=true]:bg-[var(--color-brand-800)] aria-[pressed=true]:text-white"
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
          class="rounded-full border border-[var(--color-brand-300)] bg-white px-4 py-1.5 font-semibold text-brand-900 hover:bg-[var(--color-brand-50)] disabled:opacity-60"
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
      <NikolausAdminMatrix
        slots={data.slots}
        bookings={data.bookings}
        {dates}
        onselect={(booking) => (selected = booking)}
      />
    {:else}
      <NikolausAdminList
        bookings={data.bookings}
        {dates}
        onselect={(booking) => (selected = booking)}
      />
    {/if}
  </div>
{/if}

<NikolausAdminDetails
  booking={selected}
  onclose={() => (selected = null)}
  onmessage={openMessage}
/>

<NikolausMessageDialog
  booking={messageTo}
  onclose={() => (messageTo = null)}
  onsent={(booking) => {
    messageTo = null;
    notice = `Nachricht an Familie ${booking.familyName} gesendet.`;
  }}
/>
