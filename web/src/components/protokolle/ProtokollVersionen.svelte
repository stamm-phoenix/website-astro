<script lang="ts">
  import { untrack } from 'svelte';
  import ProtokollAnsicht from './ProtokollAnsicht.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import { ApiError, fetchApi } from '../../lib/api';
  import { REVISION_REASON_LABELS, formatDateTime } from '../../lib/protokollEditor';
  import type { ProtokollRevision, ProtokollRevisionListItem } from '../../lib/types';

  interface Props {
    open: boolean;
    protokollId: number;
    /** Only the writing tab may bring a version back. */
    canRestore: boolean;
    onclose: () => void;
    onrestore: (revision: ProtokollRevision) => void;
  }
  let { open, protokollId, canRestore, onclose, onrestore }: Props = $props();

  let list = $state.raw<ProtokollRevisionListItem[] | null>(null);
  let selected = $state.raw<ProtokollRevision | null>(null);
  let error = $state<string | null>(null);
  let loadingId = $state<number | null>(null);

  async function load(): Promise<void> {
    error = null;
    selected = null;
    try {
      list = await fetchApi<ProtokollRevisionListItem[]>(
        `/intern/protokoll-editor/${protokollId}/versionen`
      );
    } catch (e: unknown) {
      error = e instanceof ApiError ? e.message : 'Die Versionen konnten nicht geladen werden.';
    }
  }

  async function show(id: number): Promise<void> {
    loadingId = id;
    error = null;
    try {
      selected = await fetchApi<ProtokollRevision>(
        `/intern/protokoll-editor/${protokollId}/versionen/${id}`
      );
    } catch (e: unknown) {
      error = e instanceof ApiError ? e.message : 'Die Version konnte nicht geladen werden.';
    } finally {
      loadingId = null;
    }
  }

  $effect(() => {
    if (open) untrack(() => void load());
  });
</script>

<ModalDialog {open} title="Gesicherte Fassungen" {onclose}>
  <div class="space-y-4 px-5 py-4">
    {#if error}
      <p class="text-sm text-danger" role="alert">{error}</p>
    {/if}
    {#if selected}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <ActionButton onclick={() => (selected = null)}>Zurück zur Liste</ActionButton>
        {#if canRestore}
          <ActionButton variant="primary" onclick={() => selected && onrestore(selected)}>
            Diese Fassung wiederherstellen
          </ActionButton>
        {/if}
      </div>
      <p class="text-sm text-neutral-700">
        {REVISION_REASON_LABELS[selected.reason]}, {formatDateTime(selected.savedAt)}
        {#if canRestore}
          · Beim Wiederherstellen wird die jetzige Fassung zuerst gesichert.
        {/if}
      </p>
      <div class="border-t border-neutral-200 pt-4">
        <ProtokollAnsicht
          title={selected.title}
          date={selected.date}
          inhalt={selected.inhalt}
          idPrefix="version"
        />
      </div>
    {:else if !list}
      <p role="status" aria-live="polite" class="text-sm text-neutral-700">Wird geladen …</p>
    {:else if list.length === 0}
      <p class="text-sm text-neutral-700">
        Noch keine gesicherte Fassung. Beim Schreiben wird alle paar Minuten eine angelegt.
      </p>
    {:else}
      <p class="text-sm text-neutral-700">
        Beim Schreiben wird alle paar Minuten eine Fassung gesichert, außerdem vor jedem Übernehmen
        der Bearbeitung.
      </p>
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
        {#each list as revision (revision.id)}
          <li>
            <button
              type="button"
              class="flex w-full flex-wrap items-baseline justify-between gap-x-3 px-1 py-2.5 text-left hover:bg-neutral-100"
              aria-busy={loadingId === revision.id}
              onclick={() => show(revision.id)}
            >
              <span class="font-semibold">{formatDateTime(revision.savedAt)}</span>
              <span class="text-sm text-neutral-700">
                {REVISION_REASON_LABELS[revision.reason]} · {revision.savedBy}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</ModalDialog>
