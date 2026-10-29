<script lang="ts">
  import ActionButton from './ActionButton.svelte';
  import Toast from './Toast.svelte';
  import { errorMessage } from '../../lib/api';
  import type { NoticeKind } from '../../lib/status';

  /**
   * „PDF herunterladen“: creates the PDF on click and shows the result in a popup. `download`
   * imports the module of the PDF itself, so jsPDF stays out of the page until it is needed.
   */

  interface Props {
    download: () => Promise<void>;
    /** What failed, with what to do next, e.g. „Das PDF der Belege konnte nicht …“. */
    errorText: string;
    disabled?: boolean;
    /** The accessible name when several of these buttons are on one page. */
    label?: string;
    /** Shows the result elsewhere instead of in the own popup. */
    onresult?: (kind: NoticeKind, text: string) => void;
    class?: string;
  }
  let {
    download,
    errorText,
    disabled = false,
    label,
    onresult,
    class: className = '',
  }: Props = $props();

  let exporting = $state(false);
  let notice = $state<{ text: string; kind: NoticeKind } | null>(null);

  function show(kind: NoticeKind, text: string): void {
    if (onresult) onresult(kind, text);
    else notice = { text, kind };
  }

  async function run(): Promise<void> {
    if (exporting) return;
    exporting = true;
    notice = null;
    try {
      await download();
      show('success', 'PDF heruntergeladen.');
    } catch (failure: unknown) {
      show('error', errorMessage(failure, errorText));
    } finally {
      exporting = false;
    }
  }
</script>

<ActionButton
  variant="secondary"
  type="button"
  class={className}
  disabled={disabled || exporting}
  aria-busy={exporting}
  aria-label={label}
  onclick={() => void run()}>{exporting ? 'Erstellt PDF …' : 'PDF herunterladen'}</ActionButton
>
{#if !onresult}
  <Toast message={notice?.text ?? null} kind={notice?.kind} onclose={() => (notice = null)} />
{/if}
