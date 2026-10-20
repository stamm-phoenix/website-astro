<script lang="ts">
  import MessageText from '../ui/MessageText.svelte';
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../../lib/campflowStore.svelte';
  import { nurAktionen } from '../../lib/aktionArt';
  import { aktionZeitraum } from '../../lib/protokollEditor';
  import type { CampflowEvent, ProtokollAktion } from '../../lib/types';

  interface Props {
    open: boolean;
    /** Date of the meeting; Aktionen around it are listed first. */
    date: string;
    /** Aktionen that already have an item. */
    used: Set<string>;
    onclose: () => void;
    onselect: (aktion: ProtokollAktion) => void;
  }
  let { open, date, used, onclose, onselect }: Props = $props();

  let query = $state('');
  let showPast = $state(false);

  function toAktion(event: CampflowEvent): ProtokollAktion {
    const start = event.start_date?.slice(0, 10) ?? '';
    const ende = event.end_date?.slice(0, 10) ?? '';
    return { id: event.id, titel: event.title.trim(), start, ende };
  }

  /** Not archived, and not over before the meeting, unless past ones are shown. */
  const aktionen = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return nurAktionen(campflowEventsStore.data ?? [])
      .filter((event) => !event.archived)
      .map(toAktion)
      .filter((aktion) => showPast || !date || (aktion.ende || aktion.start || date) >= date)
      .filter((aktion) => !needle || aktion.titel.toLowerCase().includes(needle))
      .sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
  });

  $effect(() => {
    if (open) untrack(() => void fetchCampflowEvents());
  });
</script>

<ModalDialog {open} title="Tagesordnungspunkt aus einer Aktion" {onclose}>
  <div class="space-y-4 px-5 py-4">
    <div class="flex flex-wrap items-end gap-3">
      <div class="min-w-48 flex-1">
        <label for="aktion-suche" class="form-label">Aktion suchen</label>
        <input id="aktion-suche" type="search" class="form-input" bind:value={query} />
      </div>
      <label class="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" bind:checked={showPast} />
        Vergangene zeigen
      </label>
    </div>

    {#if campflowEventsStore.error}
      <p class="text-sm text-danger" role="alert">
        <MessageText text={campflowEventsStore.error} />
      </p>
      <ActionButton onclick={() => fetchCampflowEvents({ force: true })}>Erneut laden</ActionButton>
    {:else if !campflowEventsStore.data}
      <p role="status" aria-live="polite" class="text-sm text-neutral-700">
        Aktionen werden geladen …
      </p>
    {:else if aktionen.length === 0}
      <p class="text-sm text-neutral-700">Keine passende Aktion gefunden.</p>
    {:else}
      <ul
        class="max-h-[50vh] divide-y divide-neutral-200 overflow-y-auto border-y border-neutral-200"
      >
        {#each aktionen as aktion (aktion.id)}
          <li>
            <button
              type="button"
              class="flex w-full items-baseline justify-between gap-3 px-1 py-2.5 text-left hover:bg-neutral-100"
              onclick={() => onselect(aktion)}
            >
              <span class="font-semibold text-brand-900">{aktion.titel}</span>
              <span class="shrink-0 text-sm text-neutral-700">
                {aktionZeitraum(aktion)}{used.has(aktion.id) ? ' · schon auf der Tagesordnung' : ''}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</ModalDialog>
