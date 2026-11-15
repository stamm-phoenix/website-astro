<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { errorMessage } from '../../lib/api';
  import type { InventarArtikel } from '../../lib/inventur';
  interface Props {
    artikel: InventarArtikel[];
  }
  let { artikel }: Props = $props();
  let busy = $state(false);
  let error = $state('');
  async function download(): Promise<void> {
    busy = true;
    error = '';
    try {
      const { inventurSchilderPdf } = await import('../../lib/inventurQrPdf');
      await inventurSchilderPdf(artikel, window.location.origin);
    } catch (cause) {
      error = errorMessage(
        cause,
        'Die Schilder konnten nicht erstellt werden. Tippe noch einmal auf „Schilder als PDF“.'
      );
    } finally {
      busy = false;
    }
  }
</script>

<div>
  <ActionButton
    type="button"
    variant="secondary"
    disabled={busy || !artikel.length}
    onclick={download}
  >
    {busy
      ? 'Schilder werden erstellt …'
      : artikel.length === 1
        ? 'Schild als PDF'
        : 'Schilder als PDF'}
  </ActionButton>
  {#if error}<p role="alert" class="mt-2 text-sm text-danger">{error}</p>{/if}
</div>
