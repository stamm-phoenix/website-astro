<script lang="ts">
  import MessageText from './ui/MessageText.svelte';
  import { fetchCampflowBelegBild } from '../lib/campflowBelegBild';

  interface Props {
    /** Belegnummer in CampFlow, e.g. `2026-94`. */
    receiptNumber: string;
  }
  let { receiptNumber }: Props = $props();

  interface BelegSeite {
    url: string;
    width: number;
    height: number;
  }

  let seiten = $state<BelegSeite[]>([]);
  let seitenTotal = $state(0);
  let bildError = $state<string | null>(null);

  async function toSeite(blob: Blob): Promise<BelegSeite> {
    const bitmap = await createImageBitmap(blob);
    const seite = { url: URL.createObjectURL(blob), width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return seite;
  }

  // Loads the pages one after the other, so the first one shows early; a new number or closing
  // the dialog drops what is still on its way
  $effect(() => {
    const number = receiptNumber;
    let current = true;
    const loaded: BelegSeite[] = [];
    seiten = [];
    seitenTotal = 0;
    bildError = null;
    void (async () => {
      try {
        let total = 1;
        for (let page = 1; page <= total; page++) {
          const { blob, pages } = await fetchCampflowBelegBild(number, page);
          if (!current) return;
          total = pages;
          seitenTotal = pages;
          const seite = await toSeite(blob);
          loaded.push(seite);
          if (!current) return;
          seiten = [...seiten, seite];
        }
      } catch (error: unknown) {
        if (current) {
          bildError = `Der Beleg konnte nicht geladen werden (${
            error instanceof Error ? error.message : 'keine Verbindung'
          }). Prüfe deine Internetverbindung und öffne den Beleg noch einmal.`;
        }
      }
    })();
    return () => {
      current = false;
      for (const seite of loaded) URL.revokeObjectURL(seite.url);
    };
  });
</script>

<div>
  <h3 class="text-sm font-semibold text-neutral-700">
    Beleg{seitenTotal > 1 ? ` (${seitenTotal} Seiten)` : ''}
  </h3>
  {#each seiten as seite, index (seite.url)}
    <a href={seite.url} target="_blank" rel="noopener" class="mt-2 block">
      <img
        src={seite.url}
        width={seite.width}
        height={seite.height}
        alt={`Beleg ${receiptNumber}${seitenTotal > 1 ? `, Seite ${index + 1} von ${seitenTotal}` : ''}`}
        class="h-auto w-full rounded-md border border-neutral-200 bg-white"
      />
    </a>
  {/each}
  {#if bildError}
    <p class="mt-2 text-sm text-danger"><MessageText text={bildError} /></p>
  {:else if seitenTotal === 0 || seiten.length < seitenTotal}
    <div role="status" aria-live="polite" class="mt-2">
      <p class="text-sm text-neutral-700">Der Beleg wird geladen …</p>
      <div class="skeleton-element mt-2 h-48 w-full rounded"></div>
    </div>
  {/if}
</div>
