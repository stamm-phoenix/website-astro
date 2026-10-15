<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { formatTime } from '../../lib/nikolausFahrtView';
  import {
    nikolausFahrtStore,
    saveNikolausRoute,
    forgetNikolausRoute,
    discardNikolausVisit,
  } from '../../lib/nikolausFahrtStore.svelte';
  import type { StaffNikolausFahrtData } from '../../lib/types';
  interface Props {
    teamInfo: StaffNikolausFahrtData['teams'][number] | null;
    savedHere: boolean | undefined;
    offline: boolean;
    refresh: () => Promise<void>;
  }
  let { teamInfo, savedHere, offline, refresh }: Props = $props();
  const snapshot = $derived(nikolausFahrtStore.snapshot);
</script>

{#if teamInfo}
  <section
    class="rounded-md border border-neutral-200 bg-surface p-3 text-sm"
    aria-label="Route auf diesem Gerät"
  >
    {#if savedHere && snapshot}
      <p>
        Diese Teamroute ist auf diesem Gerät bis {formatTime(new Date(snapshot.expiresAt))} Uhr gespeichert
        (maximal zwölf Stunden).
      </p>
      <p class="mt-1 text-neutral-700">
        Bitte die Seite während der Fahrt geöffnet lassen. Navigation in Karten-Apps benötigt
        gegebenenfalls eine eigene Offline-Karte.
      </p>
      <ActionButton
        variant="secondary"
        type="button"
        class="mt-2"
        onclick={async () => {
          if (
            !snapshot.queue.length ||
            (await confirmAction({
              title: 'Lokale Route löschen?',
              message: 'Lokale Route und ausstehende Markierungen unwiderruflich löschen?',
            }))
          )
            void forgetNikolausRoute();
        }}>Lokale Route und Markierungen löschen</ActionButton
      >
    {:else}
      <p>
        Speichert eure Teamroute vor der Fahrt für Funklöcher. Familiendaten bleiben maximal zwölf
        Stunden auf diesem Gerät; verwendet dafür ein eigenes oder ein Teamgerät.
      </p>
      <ActionButton
        variant="secondary"
        type="button"
        class="mt-2"
        disabled={offline}
        onclick={() => saveNikolausRoute(teamInfo.name)}
        >Route für Funklöcher speichern</ActionButton
      >
    {/if}
  </section>
{/if}
{#if snapshot?.queue.length}
  <section
    class="rounded-md border border-[#f5cf9f] bg-warning-soft p-3 text-sm text-warning"
    aria-label="Ausstehende Besuchsmarkierungen"
    aria-live="polite"
  >
    <p class="font-semibold">
      {nikolausFahrtStore.syncing
        ? 'Markierungen werden abgeglichen …'
        : `${snapshot.queue.length} Markierung(en) noch nicht bestätigt`}
    </p>
    <p>
      Solange eine Markierung aussteht, sehen Familien und Disposition sie noch nicht zuverlässig.
      Besuchszeiten werden beim Serverabgleich gesetzt.
    </p>
    <ul class="mt-2 space-y-2">
      {#each snapshot.queue as entry (entry.operationId)}
        <li>
          {snapshot.data.routes[snapshot.team]?.find((stop) => stop.bookingId === entry.bookingId)
            ?.familyName ?? 'Besuch'}:
          {entry.visited ? 'besucht' : 'zurücksetzen'} –
          {entry.status === 'conflict'
            ? 'Konflikt: Besuch oder Planung inzwischen geändert. Aktuellen Stand prüfen und bei Bedarf neu markieren.'
            : 'wartet auf Verbindung und Bestätigung'}
          <button
            type="button"
            class="ml-2 font-semibold underline"
            onclick={async () => {
              if (
                await confirmAction({
                  title: 'Markierung verwerfen?',
                  message:
                    'Diese lokale Markierung verwerfen? Ein möglicherweise bereits gespeicherter Serverstand bleibt bestehen.',
                  confirmLabel: 'Verwerfen',
                })
              )
                void discardNikolausVisit(entry.operationId);
            }}>Markierung verwerfen</button
          >
        </li>
      {/each}
    </ul>
    <ActionButton
      variant="secondary"
      type="button"
      class="mt-2"
      disabled={nikolausFahrtStore.syncing}
      onclick={refresh}>Jetzt abgleichen</ActionButton
    >
  </section>
{/if}
