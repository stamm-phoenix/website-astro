<script lang="ts">
  import { formatNikolausDate } from '../lib/nikolausConfig';
  import {
    STATUS_CLASS,
    STATUS_LABEL,
    activeBookingsBySlot,
    isActiveBooking,
    isSlotPast,
  } from '../lib/nikolausAdmin';
  import type { StaffNikolausBooking, StaffNikolausSlot } from '../lib/types';

  interface Props {
    slots: StaffNikolausSlot[];
    bookings: StaffNikolausBooking[];
    dates: string[];
    onselect: (booking: StaffNikolausBooking) => void;
    /** Called when a booking is dropped onto a free place of another slot. */
    onmove?: (booking: StaffNikolausBooking, slotKey: string) => void;
  }

  let { slots, bookings, dates, onselect, onmove }: Props = $props();

  /** Booking currently being dragged, and the slot it hovers over. */
  let dragging = $state<StaffNikolausBooking | null>(null);
  let dropTarget = $state<string | null>(null);

  function canDropOn(slot: StaffNikolausSlot): boolean {
    return dragging !== null && dragging.slotKey !== slot.key && !isSlotPast(slot.key);
  }

  function ondragstart(event: DragEvent, booking: StaffNikolausBooking): void {
    dragging = booking;
    event.dataTransfer?.setData('text/plain', booking.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function ondragend(): void {
    dragging = null;
    dropTarget = null;
  }

  function ondrop(event: DragEvent, slot: StaffNikolausSlot): void {
    event.preventDefault();
    const booking = dragging;
    ondragend();
    if (booking && booking.slotKey !== slot.key && !isSlotPast(slot.key))
      onmove?.(booking, slot.key);
  }

  const times = $derived([...new Set(slots.map((s) => s.time))].sort());
  const slotByKey = $derived(new Map(slots.map((s) => [s.key, s])));

  const bookingsBySlot = $derived(activeBookingsBySlot(bookings));

  function cellBookings(key: string): StaffNikolausBooking[] {
    return bookingsBySlot[key] ?? [];
  }

  function freePlaces(slot: StaffNikolausSlot): number {
    return Math.max(0, slot.capacity - cellBookings(slot.key).length);
  }
</script>

<div class="surface overflow-x-auto p-3 md:p-4">
  <table class="w-full border-separate border-spacing-2 text-sm">
    <caption class="sr-only">
      Belegung der Zeitslots pro Tag; jede Kachel entspricht einem Platz (Team).
    </caption>
    <thead>
      <tr>
        <th scope="col" class="w-20 text-left text-xs uppercase tracking-[0.06em] text-neutral-700">
          Uhrzeit
        </th>
        {#each dates as date (date)}
          <th scope="col" class="min-w-[16rem] text-left font-serif text-lg text-brand-900">
            {formatNikolausDate(date)}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each times as time (time)}
        <tr>
          <th
            scope="row"
            class="align-top pt-2 text-left font-semibold tabular-nums text-brand-900"
          >
            {time}
          </th>
          {#each dates as date (date)}
            {@const slot = slotByKey.get(`${date}T${time}`)}
            <td class="align-top">
              {#if slot}
                {@const cell = cellBookings(slot.key)}
                {@const overbooked = cell.length > slot.capacity}
                {#if overbooked}
                  <p class="mb-1 text-xs font-semibold text-[var(--color-dpsg-red)]">
                    <span aria-hidden="true">⚠</span> Überbucht: {cell.length} Buchungen für {slot.capacity}
                    {slot.capacity === 1 ? 'Team' : 'Teams'}
                  </p>
                {/if}
                <div
                  class="grid gap-1.5 rounded-md p-1.5 {overbooked
                    ? 'bg-[#f7e3e5] outline-2 outline-dashed outline-[var(--color-dpsg-red)]'
                    : 'bg-[var(--color-neutral-50)]'}"
                  style="grid-template-columns: repeat({Math.max(
                    slot.capacity,
                    cell.length
                  )}, minmax(7rem, 1fr));"
                >
                  {#each cell as booking, index (booking.id)}
                    <button
                      type="button"
                      draggable={onmove && isActiveBooking(booking) ? 'true' : undefined}
                      ondragstart={(event) => ondragstart(event, booking)}
                      {ondragend}
                      onclick={() => onselect(booking)}
                      class="tile rounded-md border bg-white p-2 text-left shadow-soft hover:-translate-y-[1px] {index >=
                      slot.capacity
                        ? 'border-[var(--color-dpsg-red)] ring-2 ring-[var(--color-dpsg-red)]/30'
                        : 'border-neutral-200'}"
                    >
                      <span class="block truncate font-semibold text-brand-900">
                        {booking.familyName}
                      </span>
                      <span class="block truncate text-xs text-neutral-700">
                        {booking.postalCode}
                        {booking.city}
                      </span>
                      <span class="mt-1 flex flex-wrap items-center gap-1 text-xs">
                        <span class="tabular-nums">
                          {booking.childrenCount}
                          {booking.childrenCount === 1 ? 'Kind' : 'Kinder'}
                        </span>
                        {#if booking.withKrampus}
                          <span>· Krampus</span>
                        {/if}
                      </span>
                      <span
                        class="mt-1 inline-block rounded-full border px-1.5 text-[0.65rem] font-semibold {STATUS_CLASS[
                          booking.status
                        ]}"
                      >
                        {STATUS_LABEL[booking.status]}
                      </span>
                      {#if index >= slot.capacity}
                        <span
                          class="mt-1 block text-[0.65rem] font-semibold text-[var(--color-dpsg-red)]"
                        >
                          kein Team frei – verlegen
                        </span>
                      {/if}
                    </button>
                  {/each}
                  {#each Array.from({ length: freePlaces(slot) }, (_, i) => i) as index (index)}
                    <div
                      role="presentation"
                      class="flex min-h-[5.5rem] items-center justify-center rounded-md border border-dashed text-xs transition {dropTarget ===
                      slot.key
                        ? 'border-[var(--color-dpsg-pfadfinder)] bg-[#e3f1e8] text-[var(--color-dpsg-pfadfinder)]'
                        : canDropOn(slot)
                          ? 'border-[var(--color-brand-400)] bg-[var(--color-brand-50)] text-brand-800'
                          : 'border-neutral-300 text-neutral-700'}"
                      ondragover={(event) => {
                        if (!canDropOn(slot)) return;
                        event.preventDefault();
                        dropTarget = slot.key;
                      }}
                      ondragleave={() => {
                        if (dropTarget === slot.key) dropTarget = null;
                      }}
                      ondrop={(event) => ondrop(event, slot)}
                    >
                      {dropTarget === slot.key ? 'hierher verlegen' : 'frei'}
                    </div>
                  {/each}
                </div>
              {:else}
                <span class="sr-only">Kein Slot</span>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .tile {
    transition: transform 0.15s ease;
  }
</style>
