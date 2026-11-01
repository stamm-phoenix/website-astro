<script lang="ts" module>
  /** Loaded previews by receipt and version, so polling does not load them again. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache, never rendered
  const geladen = new Map<string, Promise<string>>();
</script>

<script lang="ts">
  import type { PlanungBeleg } from '../../lib/types';
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
    const key = `${beleg.id}:${beleg.etag}`;
    const api = kontext.api;
    const id = beleg.id;
    let laden = geladen.get(key);
    if (!laden) {
      laden = api.belegFoto(id, 'vorschau').then((datei) => URL.createObjectURL(datei.blob));
      geladen.set(key, laden);
      laden.catch(() => geladen.delete(key));
    }
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
  class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-neutral-300 bg-neutral-100 hover:border-brand-900 any-pointer-coarse:size-11"
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
