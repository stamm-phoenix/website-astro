<script lang="ts">
  import { errorMessage } from '../../lib/api';
  import ActionButton from '../ui/ActionButton.svelte';
  import StatusNotice from './StatusNotice.svelte';

  interface Props {
    /** Creates and saves the PDF; loads the PDF module itself, so it stays out of the page. */
    create: () => Promise<void>;
    label?: string;
    disabled?: boolean;
    class?: string;
  }
  let {
    create,
    label = 'PDF herunterladen',
    disabled = false,
    class: className = '',
  }: Props = $props();

  let busy = $state(false);
  let message = $state<string | null>(null);
  let kind = $state<'success' | 'error'>('success');

  async function download(): Promise<void> {
    busy = true;
    message = null;
    try {
      await create();
      message = 'PDF heruntergeladen.';
      kind = 'success';
    } catch (error) {
      message = errorMessage(
        error,
        `Das PDF konnte nicht erstellt werden. Es wurde nichts geändert. Tippe noch einmal auf „${label}“.`
      );
      kind = 'error';
    } finally {
      busy = false;
    }
  }
</script>

<div class={['flex flex-wrap items-center gap-x-3 gap-y-1', className]}>
  <ActionButton
    variant="secondary"
    disabled={disabled || busy}
    aria-busy={busy}
    onclick={() => void download()}>{busy ? 'Erstellt PDF …' : label}</ActionButton
  >
  <StatusNotice {message} {kind} popup />
</div>
