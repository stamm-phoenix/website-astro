<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { FELD_NAMEN, type KopfFeld } from './gerichtKopf';

  /**
   * Under the fields of a dish: fields someone else changed under the typed input, with the
   * choice, and fields whose save failed, to save them again.
   */

  interface Props {
    konflikte: KopfFeld[];
    ungespeichert: KopfFeld[];
    busy: boolean;
    onspeichern: (feld: KopfFeld, bewusst: boolean) => void;
    onverwerfen: (feld: KopfFeld) => void;
  }
  let { konflikte, ungespeichert, busy, onspeichern, onverwerfen }: Props = $props();
</script>

{#each konflikte as feld (feld)}
  <div class="space-y-2 border-l-4 border-warning py-1 pl-3" role="alert">
    <p class="text-sm text-warning">
      Jemand anderes hat {FELD_NAMEN[feld]} gerade geändert. Deine Eingabe steht noch im Feld.
    </p>
    <div class="flex flex-wrap gap-2">
      <ActionButton
        type="button"
        variant="primary"
        disabled={busy}
        onclick={() => onspeichern(feld, true)}
      >
        Trotzdem speichern
      </ActionButton>
      <ActionButton type="button" onclick={() => onverwerfen(feld)}>
        Neuen Stand nehmen
      </ActionButton>
    </div>
  </div>
{/each}
{#each ungespeichert.filter((feld) => !konflikte.includes(feld)) as feld (feld)}
  <div class="flex flex-wrap items-center gap-2 border-l-4 border-danger py-1 pl-3" role="alert">
    <p class="text-sm text-danger">Noch nicht gespeichert: {FELD_NAMEN[feld]}.</p>
    <ActionButton type="button" disabled={busy} onclick={() => onspeichern(feld, false)}>
      {FELD_NAMEN[feld]} speichern
    </ActionButton>
  </div>
{/each}
