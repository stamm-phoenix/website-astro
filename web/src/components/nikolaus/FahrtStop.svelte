<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { navigationLink, mapsPoint, slotLabel } from '../../lib/nikolausMaps';
  import type { StaffNikolausFahrtStop } from '../../lib/types';
  interface Props {
    stop: StaffNikolausFahrtStop;
    index: number;
    color: string;
    isNext: boolean;
    busy: boolean;
    queued: boolean;
    onvisited: (visited: boolean) => void;
  }
  let { stop, index, color, isNext, busy, queued, onvisited }: Props = $props();
</script>

{#snippet details(stop: StaffNikolausFahrtStop)}
  <p class="text-neutral-800">
    {stop.childrenCount}
    {stop.childrenCount === 1 ? 'Kind' : 'Kinder'}
    {#if stop.withKrampus}· <strong>mit Krampus</strong>{/if}
  </p>
  {#if stop.hidingPlace}
    <p class="mt-2 border-l-4 border-[var(--color-brand-300)] py-0.5 pl-3 text-neutral-900">
      <span class="font-semibold">Versteck:</span>
      {stop.hidingPlace}
    </p>
  {/if}
  {#if stop.addressNotes}
    <p class="mt-2"><span class="font-semibold">Zur Adresse:</span> {stop.addressNotes}</p>
  {/if}
  {#if stop.notes}
    <p class="mt-1"><span class="font-semibold">Bemerkungen:</span> {stop.notes}</p>
  {/if}
  {#if stop.moved}
    <p class="mt-1 font-semibold text-warning">
      <span aria-hidden="true">⚠</span> Seit der Dispo auf {stop.slotKey.split('T')[1]} Uhr verlegt
    </p>
  {/if}
  {#if !stop.location}
    <p class="mt-1 text-warning">Adresse nicht auf der Karte gefunden – bitte genau prüfen</p>
  {:else if stop.location.approximate}
    <p class="mt-1 text-warning">Nur der Ort wurde gefunden – bitte genau prüfen</p>
  {/if}
{/snippet}

{#snippet actions(stop: StaffNikolausFahrtStop, primary: boolean)}
  <div class="mt-4 flex flex-wrap gap-2">
    <a
      class="btn-secondary min-h-12"
      href={navigationLink(mapsPoint(stop))}
      target="_blank"
      rel="noopener noreferrer"
    >
      Navigation<span class="sr-only"> zu Familie {stop.familyName}</span>
    </a>
    {#if stop.phone}
      <a class="btn-secondary min-h-12" href="tel:{stop.phone}">
        Anrufen<span class="sr-only"> bei Familie {stop.familyName}</span>
      </a>
    {/if}
    <button
      type="button"
      class="{primary ? 'btn-primary' : 'btn-secondary'} min-h-12 grow sm:grow-0 sm:px-6"
      disabled={busy}
      onclick={() => onvisited(true)}
    >
      <span aria-hidden="true">✓</span> Besucht<span class="sr-only">
        (Familie {stop.familyName})</span
      >
    </button>
  </div>
{/snippet}

<li>
  {#if stop.visited}
    <div class="flex items-center gap-3 py-2 text-neutral-700">
      <span
        class="flex size-7 shrink-0 items-center justify-center rounded-full bg-success text-xs font-bold text-neutral-50"
        aria-hidden="true">✓</span
      >
      <p class="min-w-0 flex-1">
        <span class="font-semibold text-neutral-900">Familie {stop.familyName}</span>
        <span class="block text-xs">
          {queued ? 'Besucht – noch nicht bestätigt' : 'Besucht'}{stop.visitedAt
            ? ` um ${stop.visitedAt} Uhr`
            : ''}
        </span>
      </p>
      <ActionButton
        variant="secondary"
        type="button"
        disabled={busy}
        onclick={() => onvisited(false)}
      >
        Rückgängig<span class="sr-only"> (Familie {stop.familyName})</span>
      </ActionButton>
    </div>
  {:else if isNext}
    <article
      aria-label="Als Nächstes: Familie {stop.familyName}"
      class="border-l-4 py-4 pl-4"
      style:border-left-color={color}
    >
      <p class="text-sm font-semibold" style:color>
        Als Nächstes · {index + 1}. Besuch
      </p>
      <p class="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span class="text-xl font-semibold tabular-nums text-brand-900"
          >ca. {stop.plannedArrival} Uhr</span
        >
        <span class="text-neutral-700">Slot {slotLabel(stop.slotKey)}</span>
      </p>
      <p class="text-lg font-semibold text-neutral-900">
        Familie {stop.familyName}
      </p>
      <p class="text-base text-neutral-800">
        {stop.street}, {stop.postalCode}
        {stop.city}
      </p>
      <div class="mt-2 text-base">{@render details(stop)}</div>
      {@render actions(stop, true)}
    </article>
  {:else}
    <details class="group">
      <summary class="flex min-h-12 cursor-pointer items-start gap-3 py-3">
        <span
          class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style:background={color}
          aria-hidden="true">{index + 1}</span
        >
        <span class="min-w-0 flex-1">
          <span class="font-semibold tabular-nums text-brand-900">ca. {stop.plannedArrival}</span>
          ·
          <span class="font-semibold text-neutral-900">Familie {stop.familyName}</span>
          <span class="block text-neutral-700">{stop.street}, {stop.city}</span>
        </span>
        <span
          class="mt-1 text-neutral-700 transition-transform group-open:rotate-180"
          aria-hidden="true">▾</span
        >
      </summary>
      <div class="pb-4 pl-10">
        <p class="text-neutral-700">Slot {slotLabel(stop.slotKey)}</p>
        {@render details(stop)}
        {@render actions(stop, false)}
      </div>
    </details>
  {/if}
</li>

<style>
  summary::-webkit-details-marker {
    display: none;
  }
  summary {
    list-style: none;
  }
  summary:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
