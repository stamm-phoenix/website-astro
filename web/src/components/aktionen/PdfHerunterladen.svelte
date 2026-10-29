<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import Toast from '../ui/Toast.svelte';
  import { errorMessage } from '../../lib/api';

  interface Result {
    message: string;
    kind: 'success' | 'error';
  }

  interface Props {
    /** Builds and saves the PDF; loads its module only when clicked. */
    create: () => Promise<void>;
    disabled?: boolean;
    /** Shown when the PDF fails without a message of its own. */
    errorText: string;
    /** Shows the result in the page's own popup instead of one of this button. */
    onresult?: (result: Result) => void;
  }

  let { create, disabled = false, errorText, onresult }: Props = $props();
  let busy = $state(false);
  let toast = $state<Result | null>(null);

  function show(result: Result): void {
    if (onresult) onresult(result);
    else toast = result;
  }

  async function download(): Promise<void> {
    busy = true;
    try {
      await create();
      show({ message: 'PDF heruntergeladen.', kind: 'success' });
    } catch (error) {
      show({ message: errorMessage(error, errorText), kind: 'error' });
    } finally {
      busy = false;
    }
  }
</script>

<ActionButton disabled={disabled || busy} onclick={() => void download()}
  >{busy ? 'Erstellt PDF …' : 'PDF herunterladen'}</ActionButton
>
{#if !onresult}
  <Toast
    message={toast?.message ?? null}
    kind={toast?.kind ?? 'success'}
    onclose={() => (toast = null)}
  />
{/if}
