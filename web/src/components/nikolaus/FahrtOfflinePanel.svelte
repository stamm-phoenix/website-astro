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
    /**
     * Told whether the route was removed from this device. The page shows the result, because
     * this panel disappears when the removed route was all there was to show.
     */
    onforget: (removed: boolean) => void;
  }
  let { teamInfo, savedHere, offline, refresh, onforget }: Props = $props();
  const snapshot = $derived(nikolausFahrtStore.snapshot);

  async function remove(): Promise<void> {
    if (
      snapshot?.queue.length &&
      !(await confirmAction({
        title: 'Route von diesem Gerät löschen?',
        message: 'Die noch nicht bestätigten Markierungen gehen dabei verloren.',
      }))
    ) {
      return;
    }
    onforget(await forgetNikolausRoute());
  }
</script>

{#if teamInfo}
  <section
    class="rounded-md border border-neutral-200 bg-surface p-3 text-sm"
    aria-label="Route auf diesem Gerät"
  >
    {#if savedHere && snapshot}
      <p>Auf diesem Gerät gespeichert bis {formatTime(new Date(snapshot.expiresAt))} Uhr.</p>
      <p class="mt-1 text-neutral-700">Lasst die Seite während der Fahrt geöffnet.</p>
      <ActionButton variant="secondary" type="button" class="mt-2" onclick={remove}
        >Route von diesem Gerät löschen</ActionButton
      >
    {:else}
      <p>
        Die Daten bleiben bis zu zwölf Stunden auf diesem Gerät – nur auf dem eigenen oder dem
        Teamhandy.
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
    <p>Familien und Disposition sehen sie erst nach dem Abgleich.</p>
    <ul class="mt-2 space-y-2">
      {#each snapshot.queue as entry (entry.operationId)}
        <li>
          {snapshot.data.routes[snapshot.team]?.find((stop) => stop.bookingId === entry.bookingId)
            ?.familyName ?? 'Besuch'}:
          {entry.visited ? 'besucht' : 'zurücksetzen'} –
          {entry.status === 'conflict'
            ? 'Konflikt: Besuch oder Planung inzwischen geändert. Aktuellen Stand prüfen und bei Bedarf neu markieren.'
            : 'wartet auf Verbindung'}
          <button
            type="button"
            class="ml-2 font-semibold underline"
            onclick={async () => {
              if (
                await confirmAction({
                  title: 'Markierung verwerfen?',
                  message: 'Was schon übertragen wurde, bleibt.',
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
