<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { authStore, fetchPrincipal } from '../../lib/authStore.svelte';
  import type { ChunkRange } from '../../lib/mitschriftAudioCache';
  import {
    deleteChunks,
    isCacheSupported,
    listChunks,
    purgeExpired,
    toRanges,
  } from '../../lib/mitschriftAudioCache';
  import { formatClock, mitschriftUrl, transcribeRange } from '../../lib/mitschriften';

  /**
   * Offers pieces of a live recording that were never transcribed (crash, closed tab, browser
   * restart) on this computer to the person who recorded them: only „Transkribieren“ or
   * „Verwerfen“, never playing them back.
   */
  interface Props {
    /** Only pieces of this Mitschrift; all of the person otherwise. */
    mitschriftId?: number;
    /** Leaves out the Mitschrift that is being recorded on this page right now. */
    excludeId?: number | null;
    ondone?: () => void;
  }
  let { mitschriftId, excludeId = null, ondone }: Props = $props();

  interface Pending {
    mitschriftId: number;
    title: string;
    ranges: ChunkRange[];
    durationMs: number;
  }

  let pending = $state<Pending[]>([]);
  let busyId = $state<number | null>(null);
  let error = $state<string | null>(null);
  let confirmDiscard = $state<number | null>(null);

  async function load(): Promise<void> {
    if (!isCacheSupported()) return;
    try {
      await purgeExpired();
      await fetchPrincipal();
      const user = authStore.principal?.userDetails;
      if (!user) return;
      const ranges = toRanges(await listChunks(user)).filter(
        (range) =>
          (mitschriftId === undefined || range.mitschriftId === mitschriftId) &&
          range.mitschriftId !== excludeId
      );
      const grouped: Pending[] = [];
      for (const range of ranges) {
        let entry = grouped.find((p) => p.mitschriftId === range.mitschriftId);
        if (!entry) {
          entry = {
            mitschriftId: range.mitschriftId,
            title: range.title,
            ranges: [],
            durationMs: 0,
          };
          grouped.push(entry);
        }
        entry.ranges.push(range);
        entry.durationMs += range.endMs - range.startMs;
      }
      pending = grouped;
    } catch {
      // Without the cache there is nothing to offer
    }
  }

  async function transcribe(entry: Pending): Promise<void> {
    busyId = entry.mitschriftId;
    error = null;
    try {
      // A range that is uploaded leaves the list, so a retry after an error skips it
      while (entry.ranges.length > 0) {
        await transcribeRange(entry.ranges[0]);
        entry.ranges = entry.ranges.slice(1);
      }
      pending = pending.filter((p) => p.mitschriftId !== entry.mitschriftId);
      if (mitschriftId === undefined) window.location.href = mitschriftUrl(entry.mitschriftId);
      else ondone?.();
    } catch {
      error =
        'Das Transkribieren konnte nicht gestartet werden. Gibt es die Mitschrift noch und besteht eine Verbindung?';
    } finally {
      busyId = null;
    }
  }

  async function discard(entry: Pending): Promise<void> {
    busyId = entry.mitschriftId;
    try {
      await deleteChunks(entry.ranges.flatMap((range) => range.chunks.map((c) => c.id)));
      pending = pending.filter((p) => p.mitschriftId !== entry.mitschriftId);
      confirmDiscard = null;
    } finally {
      busyId = null;
    }
  }

  $effect(() => {
    untrack(() => void load());
  });
</script>

{#each pending as entry (entry.mitschriftId)}
  <div
    class="border-l-2 border-warning py-1 pl-4 text-sm"
    role="region"
    aria-label="Nicht transkribierte Aufnahme"
  >
    <p class="font-semibold text-warning">
      Es gibt noch nicht transkribierte Teile der Mitschrift „{entry.title}“ – jetzt transkribieren?
    </p>
    <p class="mt-1 text-neutral-700">
      Etwa {formatClock(entry.durationMs)} Audio ab {formatClock(entry.ranges[0].startMs)},
      verschlüsselt nur in diesem Browser gespeichert. Ohne Transkription wird es nach sieben Tagen
      verworfen.
    </p>
    <div class="mt-2 flex flex-wrap gap-2">
      <ActionButton
        variant="primary"
        disabled={busyId !== null}
        aria-busy={busyId === entry.mitschriftId}
        onclick={() => transcribe(entry)}
      >
        {busyId === entry.mitschriftId ? 'Wird hochgeladen …' : 'Transkribieren'}
      </ActionButton>
      {#if confirmDiscard === entry.mitschriftId}
        <ActionButton variant="danger" disabled={busyId !== null} onclick={() => discard(entry)}>
          Endgültig verwerfen
        </ActionButton>
        <ActionButton onclick={() => (confirmDiscard = null)}>Abbrechen</ActionButton>
      {:else}
        <ActionButton
          disabled={busyId !== null}
          onclick={() => (confirmDiscard = entry.mitschriftId)}
        >
          Verwerfen
        </ActionButton>
      {/if}
    </div>
    {#if error && busyId === null}
      <p class="mt-2 text-danger" role="alert">{error}</p>
    {/if}
  </div>
{/each}
