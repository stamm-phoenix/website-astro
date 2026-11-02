<script lang="ts">
  import { untrack } from 'svelte';
  import BelegSeiten from './BelegSeiten.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import { errorMessage, fetchFile } from '../../lib/api';
  import { freeSeiten, loadWeitereSeiten, type PdfSeite } from '../../lib/belegPdf';

  /**
   * The further pages of a stored receipt PDF, drawn in the browser from the PDF; the picture of
   * the first page is shown above them.
   */
  interface Props {
    /** The stored PDF, for `fetchFile`. */
    path: string;
    class?: string;
  }
  let { path, class: imgClass = '' }: Props = $props();

  const FEHLER =
    'Die weiteren Seiten des PDFs konnten nicht angezeigt werden. Lade das PDF herunter, um sie anzusehen.';

  let geladen = $state.raw<{ weitere: PdfSeite[]; seiten: number } | null>(null);
  /** Why the pages could not be shown, e.g. an expired login; null while there is no error. */
  let fehler = $state<string | null>(null);
  /** Counts the attempts, so „Erneut versuchen“ loads the PDF again. */
  let versuch = $state(0);

  $effect(() => {
    const current = path;
    void versuch;
    const controller = new AbortController();
    let result: { weitere: PdfSeite[]; seiten: number } | null = null;
    untrack(() => {
      geladen = null;
      fehler = null;
    });
    void (async () => {
      try {
        const file = await fetchFile(current, controller.signal);
        if (controller.signal.aborted) return;
        result = await loadWeitereSeiten(file.blob);
        if (controller.signal.aborted) freeSeiten(result.weitere);
        else geladen = result;
      } catch (error: unknown) {
        if (!controller.signal.aborted) fehler = errorMessage(error, FEHLER);
      }
    })();
    return () => {
      controller.abort();
      if (result) freeSeiten(result.weitere);
    };
  });
</script>

<LoadState
  data={geladen}
  loading={!geladen && !fehler}
  error={fehler}
  loadingText="Weitere Seiten des PDFs werden geladen …"
  onretry={() => versuch++}
>
  {#snippet skeleton()}
    <p class="text-sm text-neutral-700">Weitere Seiten des PDFs werden geladen …</p>
  {/snippet}
  {#snippet children(data)}
    <BelegSeiten seiten={data.weitere} seitenzahl={data.seiten} class={imgClass} />
  {/snippet}
</LoadState>
