<script lang="ts">
  import { onMount } from 'svelte';
  import {
    countFreePlaces,
    formatShortDate,
    getOverbookedSlots,
    isActiveBooking,
  } from '../../lib/nikolausAdmin';
  import type { StaffNikolausBooking, StaffNikolausSlot } from '../../lib/types';

  interface Props {
    slots: StaffNikolausSlot[];
    bookings: StaffNikolausBooking[];
    dates: string[];
  }
  let { slots, bookings, dates }: Props = $props();

  let overviewOpen = $state(false);
  onMount(() => {
    overviewOpen = window.matchMedia('(min-width: 640px)').matches;
  });

  const stats = $derived(
    dates.map((date) => {
      const daySlots = slots.filter((s) => s.date === date);
      const dayBookings = bookings.filter((b) => b.slotKey.startsWith(date));
      const active = dayBookings.filter(isActiveBooking);
      const capacity = daySlots.reduce((sum, s) => sum + s.capacity, 0);
      return {
        date,
        confirmed: dayBookings.filter((b) => b.status === 'confirmed').length,
        pending: dayBookings.filter((b) => b.status === 'pending').length,
        children: active.reduce((sum, b) => sum + b.childrenCount, 0),
        // Counted per slot, so an overbooked slot cannot hide free places elsewhere
        free: countFreePlaces(daySlots, dayBookings),
        capacity,
        overbooked: getOverbookedSlots(daySlots, dayBookings).length,
      };
    })
  );
</script>

<details bind:open={overviewOpen} class="space-y-3">
  <summary class="min-h-11 cursor-pointer py-2 text-brand-900">
    <h2 id="nikolaus-stats-heading" class="inline font-serif text-lg">Überblick über die Tage</h2>
  </summary>
  <section aria-labelledby="nikolaus-stats-heading">
    <!-- Below sm each day is a row of four labelled values instead of five columns. -->
    <div class="sm:overflow-x-auto">
      <table class="w-full text-sm max-sm:block sm:min-w-[32rem]">
        <thead class="max-sm:sr-only">
          <tr class="border-b-2 border-neutral-300 text-left text-neutral-700">
            <th scope="col" class="py-2 pr-4 font-semibold">Tag</th>
            <th scope="col" class="py-2 pr-4 text-right font-semibold">Bestätigt</th>
            <th scope="col" class="py-2 pr-4 text-right font-semibold">Ausstehend</th>
            <th scope="col" class="py-2 pr-4 text-right font-semibold">Frei</th>
            <th scope="col" class="py-2 text-right font-semibold">Kinder</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-neutral-200 max-sm:block">
          {#each stats as day (day.date)}
            <tr class="max-sm:grid max-sm:grid-cols-4 max-sm:gap-x-2 max-sm:py-3">
              <th scope="row" class="py-3 pr-4 text-left align-top max-sm:col-span-4 max-sm:p-0">
                <span class="block font-serif text-lg font-semibold text-brand-900">
                  {formatShortDate(day.date)}
                </span>
                {#if day.overbooked > 0}
                  <span class="block text-sm font-semibold text-danger">
                    <span aria-hidden="true">⚠</span>
                    {day.overbooked}
                    {day.overbooked === 1 ? 'Termin überbucht' : 'Termine überbucht'}
                  </span>
                {/if}
              </th>
              <td
                class="py-3 pr-4 text-right align-top text-xl font-semibold tabular-nums text-success max-sm:mt-1 max-sm:p-0 max-sm:text-left"
              >
                <span
                  class="block text-xs font-semibold text-neutral-700 sm:hidden"
                  aria-hidden="true">Bestätigt</span
                >
                {day.confirmed}
              </td>
              <td
                class="py-3 pr-4 text-right align-top text-xl font-semibold tabular-nums text-warning max-sm:mt-1 max-sm:p-0 max-sm:text-left"
              >
                <span
                  class="block text-xs font-semibold text-neutral-700 sm:hidden"
                  aria-hidden="true">Ausstehend</span
                >
                {day.pending}
              </td>
              <td
                class="py-3 pr-4 text-right align-top text-xl font-semibold tabular-nums text-brand-900 max-sm:mt-1 max-sm:p-0 max-sm:text-left"
              >
                <span
                  class="block text-xs font-semibold text-neutral-700 sm:hidden"
                  aria-hidden="true">Frei</span
                >
                {day.free}<span class="text-sm font-normal text-neutral-700">/{day.capacity}</span>
              </td>
              <td
                class="py-3 text-right align-top text-xl font-semibold tabular-nums text-brand-900 max-sm:mt-1 max-sm:p-0 max-sm:text-left"
              >
                <span
                  class="block text-xs font-semibold text-neutral-700 sm:hidden"
                  aria-hidden="true">Kinder</span
                >
                {day.children}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</details>
