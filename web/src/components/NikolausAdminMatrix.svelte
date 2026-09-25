<script lang="ts">
  import { formatNikolausDate } from '../lib/nikolausConfig';
  import { STATUS_CLASS, STATUS_LABEL, isActiveBooking } from '../lib/nikolausAdmin';
  import type { StaffNikolausBooking, StaffNikolausSlot } from '../lib/types';

  interface Props {
    slots: StaffNikolausSlot[];
    bookings: StaffNikolausBooking[];
    dates: string[];
    onselect: (booking: StaffNikolausBooking) => void;
  }

  let { slots, bookings, dates, onselect }: Props = $props();

  const times = $derived([...new Set(slots.map((s) => s.time))].sort());
  const slotByKey = $derived(new Map(slots.map((s) => [s.key, s])));

  /** Active bookings per slot key, oldest booking (lowest id) first. */
  const bookingsBySlot = $derived.by(() => {
    const map: Record<string, StaffNikolausBooking[]> = {};
    for (const booking of bookings.filter(isActiveBooking)) {
      const list = map[booking.slotKey] ?? [];
      list.push(booking);
      map[booking.slotKey] = list;
    }
    for (const list of Object.values(map)) list.sort((a, b) => Number(a.id) - Number(b.id));
    return map;
  });

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
                <div
                  class="grid gap-1.5 rounded-md bg-[var(--color-neutral-50)] p-1.5"
                  style="grid-template-columns: repeat({Math.max(
                    slot.capacity,
                    cell.length
                  )}, minmax(7rem, 1fr));"
                >
                  {#each cell as booking, index (booking.id)}
                    <button
                      type="button"
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
                        <span class="sr-only">(über der Kapazität)</span>
                      {/if}
                    </button>
                  {/each}
                  {#each Array.from({ length: freePlaces(slot) }, (_, i) => i) as index (index)}
                    <div
                      class="flex min-h-[5.5rem] items-center justify-center rounded-md border border-dashed border-neutral-300 text-xs text-neutral-700"
                    >
                      frei
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
