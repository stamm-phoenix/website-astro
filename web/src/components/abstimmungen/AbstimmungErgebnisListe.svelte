<script lang="ts">
  import StatusLabel from '../ui/StatusLabel.svelte';
  import type { AbstimmungErgebnis } from '../../lib/abstimmungen';
  import { antwortenText, spitzenreiter, stimmenText } from '../../lib/abstimmungen';

  interface Props {
    /** Unique on the page; used for the heading. */
    id: string;
    ergebnis: AbstimmungErgebnis;
  }
  let { id, ergebnis }: Props = $props();

  const vorne = $derived(spitzenreiter(ergebnis));
  const anzahl = $derived(ergebnis.antworten.length);
  /** Names per option, in the order of the answers. */
  const namen = $derived(
    new Map(
      ergebnis.optionen.map((option) => [
        option.id,
        ergebnis.antworten.filter((a) => a.gewaehlt.includes(option.id)).map((a) => a.name),
      ])
    )
  );
  const keine = $derived(ergebnis.antworten.filter((a) => a.gewaehlt.length === 0));
</script>

<section aria-labelledby="{id}-titel">
  <h2
    id="{id}-titel"
    class="border-b border-neutral-300 pb-2 font-serif text-xl font-semibold text-brand-900"
  >
    Ergebnis <span class="font-sans text-base font-normal text-neutral-700"
      >· {antwortenText(anzahl)}</span
    >
  </h2>
  {#if anzahl === 0}
    <p class="py-4 text-sm text-neutral-700">Noch hat niemand abgestimmt.</p>
  {:else}
    <ul class="divide-y divide-neutral-200 border-b border-neutral-200">
      {#each ergebnis.optionen as option (option.id)}
        {@const anteil = anzahl ? Math.round((option.stimmen / anzahl) * 100) : 0}
        {@const leute = namen.get(option.id) ?? []}
        <li class="py-3">
          <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p class="min-w-0 font-semibold text-brand-900 [overflow-wrap:anywhere]">
              {option.text}
            </p>
            <p class="flex items-center gap-2 text-sm text-neutral-700">
              {#if vorne.has(option.id)}<StatusLabel label="Meiste Stimmen" tone="success" />{/if}
              <span>{stimmenText(option.stimmen)}</span>
            </p>
          </div>
          <div
            class="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200"
            role="img"
            aria-label="{anteil} Prozent"
          >
            <div class="h-full rounded-full bg-action" style:width="{anteil}%"></div>
          </div>
          {#if leute.length > 0}
            <p class="mt-1 text-sm text-neutral-700 [overflow-wrap:anywhere]">{leute.join(', ')}</p>
          {/if}
        </li>
      {/each}
    </ul>
    {#if keine.length > 0}
      <p class="pt-2 text-sm text-neutral-700 [overflow-wrap:anywhere]">
        Keine Option passt: {keine.map((a) => a.name).join(', ')}
      </p>
    {/if}
  {/if}
</section>
