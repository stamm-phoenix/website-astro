<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { cancelFotoDownload, fotoDownload } from '../../lib/fotoDownload.svelte';

  interface Props {
    /** At the bottom of the screen, so cancelling stays in reach; not next to the upload bar. */
    sticky?: boolean;
  }
  let { sticky = false }: Props = $props();

  const ended = $derived(
    fotoDownload.phase === 'done' ||
      fotoDownload.phase === 'error' ||
      fotoDownload.phase === 'cancelled'
  );
</script>

<!-- Outside the photo view and its selection, so a running ZIP stays visible in every view -->
{#if fotoDownload.phase === 'running'}
  <section
    aria-label="Download als ZIP"
    class="surface space-y-1 px-4 py-2 {sticky ? 'zip-bar sticky bottom-0 z-20 -mx-4 sm:mx-0' : ''}"
  >
    <p class="text-sm font-semibold text-brand-900" aria-live="polite">
      ZIP wird erstellt: {fotoDownload.doneFiles} von {fotoDownload.files} Dateien
    </p>
    <progress
      class="foto-progress h-2 w-full"
      max={fotoDownload.bytes || 1}
      value={fotoDownload.doneBytes}
      aria-label="Fortschritt des Downloads"
    ></progress>
    <ActionButton onclick={cancelFotoDownload}>Download abbrechen</ActionButton>
  </section>
{:else if ended}
  <StatusNotice
    message={fotoDownload.message}
    kind={fotoDownload.phase === 'error' ? 'error' : 'success'}
    popup
  />
{/if}

<style>
  .zip-bar {
    box-shadow: 0 -4px 12px rgb(0 0 0 / 0.08);
  }
  .foto-progress {
    appearance: none;
    overflow: hidden;
    background: var(--color-neutral-200);
  }
  .foto-progress::-webkit-progress-bar {
    background: var(--color-neutral-200);
  }
  .foto-progress::-webkit-progress-value {
    background: var(--color-success);
  }
  .foto-progress::-moz-progress-bar {
    background: var(--color-success);
  }
</style>
