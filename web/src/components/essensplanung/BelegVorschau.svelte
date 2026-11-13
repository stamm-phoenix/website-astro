<script lang="ts" module>
  import { ObjectUrlCache } from '../../lib/objectUrlCache';

  /** Loaded previews by receipt, so polling does not load them again; a new version replaces one. */
  const geladen = new ObjectUrlCache();
</script>

<script lang="ts">
  import type { PlanungBeleg } from '../../../../api/lib/essen-belege-model';
  import type { PlanKontext } from './planKontext';

  /**
   * The small picture of a receipt in its row. The pictures need the token of the link in a
   * header, so they are loaded by script and shown from memory. A click opens the big picture.
   */

  interface Props {
    kontext: PlanKontext;
    beleg: PlanungBeleg;
    onoeffnen: () => void;
  }
  let { kontext, beleg, onoeffnen }: Props = $props();

  let url = $state<string | null>(null);
  let fehler = $state(false);

  $effect(() => {
    const api = kontext.api;
    const id = beleg.id;
    const laden = geladen.get(String(id), beleg.etag, () =>
      api.belegFoto(id, 'vorschau').then((datei) => datei.blob)
    );
    let aktuell = true;
    fehler = false;
    laden.then(
      (wert) => {
        if (aktuell) url = wert;
      },
      () => {
        if (aktuell) fehler = true;
      }
    );
    return () => {
      aktuell = false;
    };
  });
</script>

<button
  type="button"
  class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-neutral-300 bg-neutral-100 hover:border-brand-900 any-pointer-coarse:size-11"
  aria-label="{beleg.foto === 'pdf' ? 'PDF' : 'Foto'} des Belegs ansehen"
  title={beleg.foto === 'pdf' ? 'PDF ansehen' : 'Foto ansehen'}
  onclick={onoeffnen}
>
  {#if url}
    <img src={url} alt="" width="40" height="40" class="size-full object-cover" />
  {:else}
    <span class="text-[10px] text-neutral-700">{fehler ? 'Fehler' : '…'}</span>
  {/if}
</button>
