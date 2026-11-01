<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import { errorMessage, saveFile } from '../../lib/api';
  import { belegTitel } from '../../lib/essensplanungBelege';
  import type { PlanungBeleg } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /** The picture of a receipt in full size (for a PDF its first page), with the download. */

  interface Props {
    kontext: PlanKontext;
    beleg: PlanungBeleg | null;
    onclose: () => void;
  }
  let { kontext, beleg, onclose }: Props = $props();

  let url = $state<string | null>(null);
  let fehler = $state<string | null>(null);
  let original = $state(false);

  $effect(() => {
    const aktuell = beleg;
    const art = original ? 'original' : 'bild';
    url = null;
    fehler = null;
    if (!aktuell) return;
    let gueltig = true;
    let geladen: string | null = null;
    kontext.api.belegFoto(aktuell.id, art).then(
      (datei) => {
        geladen = URL.createObjectURL(datei.blob);
        if (gueltig) url = geladen;
        else URL.revokeObjectURL(geladen);
      },
      (error: unknown) => {
        if (gueltig)
          fehler = errorMessage(
            error,
            'Das Foto konnte nicht geladen werden. Versuche es noch einmal.'
          );
      }
    );
    return () => {
      gueltig = false;
      if (geladen) URL.revokeObjectURL(geladen);
    };
  });

  async function herunterladen(): Promise<void> {
    if (!beleg) return;
    try {
      const datei = await kontext.api.belegFoto(beleg.id, 'datei');
      saveFile(datei.blob, datei.fileName ?? (beleg.foto === 'pdf' ? 'Beleg.pdf' : 'Beleg.jpg'));
    } catch (error: unknown) {
      fehler = errorMessage(
        error,
        'Die Datei konnte nicht geladen werden. Versuche es noch einmal.'
      );
    }
  }
</script>

<ModalDialog
  open={beleg !== null}
  title={beleg ? belegTitel(beleg) : ''}
  size="wide"
  dismissOnBackdrop
  onclose={() => {
    original = false;
    onclose();
  }}
>
  {#if beleg}
    <div class="space-y-3">
      {#if url}
        <img
          src={url}
          alt="{beleg.foto === 'pdf' ? 'Erste Seite des PDFs' : 'Foto'} des Belegs"
          width="600"
          height="800"
          class="mx-auto h-auto max-h-[70vh] w-auto max-w-full border border-neutral-200 bg-neutral-100 object-contain"
        />
      {:else if fehler}
        <p class="text-sm text-danger" role="alert">{fehler}</p>
      {:else}
        <p role="status" class="text-sm text-neutral-700">Wird geladen …</p>
      {/if}
      <div class="flex flex-wrap gap-2">
        <ActionButton onclick={() => void herunterladen()}
          >{beleg.foto === 'pdf' ? 'PDF herunterladen' : 'Foto herunterladen'}</ActionButton
        >
        {#if beleg.original}
          <ActionButton onclick={() => (original = !original)} aria-pressed={original}
            >{original ? 'Bearbeitetes Foto zeigen' : 'Original zeigen'}</ActionButton
          >
        {/if}
      </div>
    </div>
  {/if}
</ModalDialog>
