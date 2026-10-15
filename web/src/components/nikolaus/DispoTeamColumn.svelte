<script lang="ts">
  import DispoStopCard from './DispoStopCard.svelte';
  import { minutesToTime } from '../../lib/nikolausDispo';
  import type { DispoPlan } from '../../lib/nikolausDispo';
  import { tagConflicts } from '../../lib/nikolausDispoPlan';
  import { mapsLinks } from '../../lib/nikolausMaps';
  import type { StaffNikolausDispoData } from '../../lib/types';
  interface Props {
    route: DispoPlan['routes'][number];
    ids: string[];
    data: StaffNikolausDispoData;
    color?: string;
    base: { name: string; lat: number; lon: number };
    fixed: Record<string, string>;
    dirty: boolean;
    date: string;
    onteam: (id: string, team: string) => void;
    onpin: (id: string, team: string) => void;
  }
  let { route, ids, data, color, base, fixed, dirty, date, onteam, onpin }: Props = $props();
  const stopsById = $derived(new Map(data.stops.map((stop) => [stop.id, stop])));
  const rowsById = $derived(new Map(data.rows.map((row) => [row.bookingId, row])));
  const childrenCount = $derived(
    ids.reduce((sum, id) => sum + (stopsById.get(id)?.childrenCount ?? 0), 0)
  );
  function visitedRow(id: string): StaffNikolausDispoData['rows'][number] | undefined {
    const row = rowsById.get(id);
    return row?.visited ? row : undefined;
  }
</script>

<section
  aria-labelledby="dispo-team-{route.team}"
  class="team-column border-t-4 print:mb-6 print:break-inside-auto"
  style:border-top-color={color}
>
  <div class="border-b border-neutral-200 py-3">
    <h2 id="dispo-team-{route.team}" class="font-serif text-xl font-semibold text-brand-900">
      Team {route.team}
    </h2>
    <p class="text-sm text-neutral-700">
      {route.stops.length}
      {route.stops.length === 1 ? 'Termin' : 'Termine'} · {childrenCount} Kinder
      {#if route.departure !== null && route.returnTime !== null}
        <br />Abfahrt {base.name}
        {minutesToTime(route.departure)} · zurück ca. {minutesToTime(route.returnTime)}
        · Fahrzeit {Math.round(route.driveMinutes)} Min
      {/if}
    </p>
    {#if (data.members[route.team] ?? []).length > 0}
      <p class="mt-1 text-sm text-neutral-800">
        {(data.members[route.team] ?? [])
          .map((member) => `${member.role}: ${member.name}`)
          .join(' · ')}
      </p>
    {/if}
  </div>
  {#if route.stops.length === 0}
    <p class="py-4 text-sm text-neutral-700">Keine Termine.</p>
  {:else}
    <ol class="divide-y divide-neutral-200 border-b border-neutral-200">
      {#each route.stops as planned, index (planned.id)}
        {@const booking = stopsById.get(planned.id)}
        {#if booking}
          <DispoStopCard
            {booking}
            {planned}
            {index}
            team={route.team}
            {color}
            teams={data.teams}
            isFixed={fixed[booking.id] === route.team}
            visited={visitedRow(booking.id)}
            conflicts={tagConflicts(data, booking, route.team)}
            onteam={(team) => onteam(booking.id, team)}
            onpin={() => onpin(booking.id, route.team)}
          />
        {/if}
      {/each}
    </ol>
    <p class="flex flex-wrap gap-x-4 py-3 text-sm print:hidden">
      {#each mapsLinks(ids, base, stopsById) as link, part (link)}
        <a
          class="font-semibold text-link underline"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
        >
          Route in Google Maps{mapsLinks(ids, base, stopsById).length > 1
            ? ` (Teil ${part + 1})`
            : ''}
        </a>
      {/each}
      {#if !dirty && data.rows.length > 0}
        <a
          class="font-semibold text-link underline"
          href="/leitendenbereich/nikolaus-fahrt?tag={encodeURIComponent(
            date
          )}&team={encodeURIComponent(route.team)}"
        >
          Fahrt-Ansicht
        </a>
      {/if}
    </p>
  {/if}
</section>

<style>
  @media print {
    :global(.team-column) + .team-column {
      break-before: page;
    }
  }
</style>
