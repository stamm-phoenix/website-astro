<script lang="ts">
  import PinToggle from './PinToggle.svelte';
  import { minutesToTime } from '../../lib/nikolausDispo';
  import { slotLabel } from '../../lib/nikolausMaps';
  import type { DispoPlannedStop } from '../../lib/nikolausDispo';
  import type {
    StaffNikolausBooking,
    StaffNikolausDispoData,
    StaffNikolausDispoRow,
  } from '../../lib/types';
  interface Props {
    booking: StaffNikolausBooking;
    planned: DispoPlannedStop;
    index: number;
    team: string;
    color?: string;
    teams: StaffNikolausDispoData['teams'];
    isFixed: boolean;
    visited?: StaffNikolausDispoRow;
    conflicts: { name: string; tags: string[] }[];
    onteam: (team: string) => void;
    onpin: () => void;
  }
  let {
    booking,
    planned,
    index,
    team,
    color,
    teams,
    isFixed,
    visited,
    conflicts,
    onteam,
    onpin,
  }: Props = $props();
  const selectId = $derived(`dispo-team-${booking.id}`);
  const NOTABLE_LATE_IN_SLOT = 10;
</script>

<li class="stop-card py-3 text-sm">
  <div class="flex items-start gap-3">
    <span
      class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
      style:background={color}
      aria-hidden="true">{index + 1}</span
    >
    <div class="min-w-0 flex-1">
      <p class="flex flex-wrap items-baseline gap-x-2">
        <span class="text-base font-semibold tabular-nums text-brand-900"
          >{minutesToTime(planned.start)}</span
        >
        <span class="text-neutral-700">Termin {slotLabel(booking.slotKey)}</span>
      </p>
      <p class="font-semibold text-neutral-900">Familie {booking.familyName}</p>
      <p class="text-neutral-800">
        {booking.street}, {booking.postalCode}
        {booking.city}
      </p>
      <p class="mt-1 text-neutral-700">
        {booking.childrenCount}
        {booking.childrenCount === 1 ? 'Kind' : 'Kinder'} · ca. {planned.end - planned.start} Min
        {#if booking.withKrampus}· mit Krampus{/if}
        · Anfahrt {Math.round(planned.driveMinutes)} Min
      </p>
      {#if booking.phone}
        <p class="text-neutral-700">
          Tel.: <a class="text-link underline" href="tel:{booking.phone}">{booking.phone}</a>
        </p>
      {/if}
      {#if booking.internalTags.length > 0}
        <p
          class="mt-1 flex flex-wrap gap-x-2 text-xs text-neutral-700"
          aria-label="Merkmale für die Einteilung"
        >
          {#each booking.internalTags as tag (tag)}
            <span class="tag">{tag}</span>
          {/each}
        </p>
      {/if}
      {#each conflicts as conflict (conflict.name)}
        <p class="mt-1 font-semibold text-danger">
          ⚠ {conflict.name} – nicht zu Familien mit „{conflict.tags.join('“, „')}“
        </p>
      {/each}
      {#if booking.hidingPlace}
        <p class="mt-1"><span class="font-semibold">Versteck:</span> {booking.hidingPlace}</p>
      {/if}
      {#if booking.addressNotes}
        <p><span class="font-semibold">Adresse:</span> {booking.addressNotes}</p>
      {/if}
      {#if booking.notes}
        <p><span class="font-semibold">Bemerkungen:</span> {booking.notes}</p>
      {/if}

      {#if planned.lateAfterSlot > 0}
        <p class="mt-1 font-semibold text-danger">
          ⚠ {Math.round(planned.lateAfterSlot)} Min nach Ende des Termins
        </p>
      {:else if planned.lateInSlot >= NOTABLE_LATE_IN_SLOT}
        <p class="mt-1 text-warning">
          {Math.round(planned.lateInSlot)} Min nach Beginn des Termins
        </p>
      {/if}
      {#if !booking.location}
        <p class="mt-1 text-warning">
          Adresse nicht auf der Karte gefunden – Fahrzeit nur geschätzt
        </p>
      {:else if booking.location.approximate}
        <p class="mt-1 text-warning">Nur der Ort wurde gefunden – Fahrzeit ungenau</p>
      {/if}
      {#if visited}
        <p class="mt-1 font-semibold text-success">
          ✓ Besucht{visited.visitedAt ? ` um ${visited.visitedAt} Uhr` : ''}
        </p>
      {/if}

      <div class="mt-2 flex flex-wrap items-center gap-2 print:hidden">
        <label class="sr-only" for={selectId}>Team für Familie {booking.familyName}</label>
        <select
          id={selectId}
          class="form-input mt-0! w-auto py-1.5 text-sm"
          value={team}
          onchange={(event) => onteam(event.currentTarget.value)}
        >
          {#each teams as option (option.name)}
            <option value={option.name}>Team {option.name}</option>
          {/each}
        </select>
        <PinToggle
          fixed={isFixed}
          label={`für Familie ${booking.familyName}`}
          onclick={() => onpin()}
        />
      </div>
    </div>
  </div>
</li>

<style>
  @media print {
    .stop-card {
      break-inside: avoid;
    }
  }
</style>
