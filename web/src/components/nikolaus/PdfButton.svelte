<script lang="ts">
  import { errorMessage } from '../../lib/api';
  import type { Notice } from '../../lib/status';
  import ActionButton from '../ui/ActionButton.svelte';

  interface Props {
    /** Loads the PDF module and saves the file; jsPDF stays out of the page until then. */
    create: () => Promise<void>;
    onresult: (notice: Notice) => void;
    /** Shown when creating fails for another reason than a missing connection. */
    errorText: string;
    disabled?: boolean;
    /** The page already knows that there is no connection right now. */
    offline?: boolean;
    class?: string;
  }
  let {
    create,
    onresult,
    errorText,
    disabled = false,
    offline = false,
    class: className = '',
  }: Props = $props();

  let busy = $state(false);

  async function download(): Promise<void> {
    busy = true;
    try {
      await create();
      onresult({ text: 'PDF heruntergeladen.', kind: 'success' });
    } catch (error: unknown) {
      // Without a connection the PDF module itself cannot be loaded
      onresult({
        text:
          offline || !navigator.onLine
            ? 'Das PDF geht nur mit Internetverbindung. Versuch es noch einmal, sobald du wieder Empfang hast.'
            : errorMessage(error, errorText),
        kind: 'error',
      });
    } finally {
      busy = false;
    }
  }
</script>

<ActionButton
  variant="secondary"
  type="button"
  class={className}
  disabled={disabled || busy}
  onclick={() => void download()}>{busy ? 'Erstellt PDF …' : 'PDF herunterladen'}</ActionButton
>
