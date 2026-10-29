<script lang="ts">
  import FilterTabs from '../ui/FilterTabs.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import AbstimmungMatrix from './AbstimmungMatrix.svelte';
  import type { AbstimmungErgebnis } from '../../lib/abstimmungen';
  import { MIN_ANTWORTEN_FUER_ZAHLEN, sichtbarkeitHinweis } from '../../lib/abstimmungen';
  import { antwortenText, spitzenreiter, stimmenText } from '../../lib/abstimmungZahlen';

  interface Props {
    /** Unique on the page; used for the heading. */
    id: string;
    ergebnis: AbstimmungErgebnis;
    /** The viewer created the Abstimmung. */
    eigene?: boolean;
  }
  let { id, ergebnis, eigene = false }: Props = $props();

  let ansicht = $state<'liste' | 'tabelle'>('liste');

  const vorne = $derived(spitzenreiter(ergebnis));
  const anzahl = $derived(ergebnis.anzahlAntworten);
  const alles = $derived(ergebnis.einsicht === 'alles');
  const hinweis = $derived(sichtbarkeitHinweis(ergebnis, eigene));
  /** Names per option, in the order of the answers. */
  const namen = $derived(
    new Map(
      ergebnis.optionen.map((option) => [
        option.id,
        {
          ja: ergebnis.antworten.filter((a) => a.gewaehlt.includes(option.id)).map((a) => a.name),
          vielleicht: ergebnis.antworten
            .filter((a) => a.vielleicht.includes(option.id))
            .map((a) => a.name),
        },
      ])
    )
  );
  const keine = $derived(
    ergebnis.antworten.filter((a) => a.gewaehlt.length === 0 && a.vielleicht.length === 0)
  );

  function prozent(count: number): number {
    return anzahl ? Math.round((count / anzahl) * 100) : 0;
  }
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
  {#if hinweis}
    <p class="pt-2 text-sm text-neutral-700">{hinweis}</p>
  {/if}
  {#if anzahl === 0}
    <p class="py-4 text-sm text-neutral-700">Noch hat niemand abgestimmt.</p>
  {:else}
    {#if alles}
      <FilterTabs
        class="mt-3"
        label="Ansicht des Ergebnisses"
        variant="segmented"
        options={[
          { value: 'liste', label: 'Je Option' },
          { value: 'tabelle', label: 'Tabelle' },
        ]}
        value={ansicht}
        onselect={(value) => (ansicht = value)}
      />
    {/if}
    {#if ergebnis.zahlenVerborgen}
      <p class="py-3 text-sm text-neutral-700">
        Die Stimmen je Option siehst du, sobald {MIN_ANTWORTEN_FUER_ZAHLEN} Personen abgestimmt haben.
      </p>
      {#if ergebnis.einsicht === 'namen'}
        <p class="text-sm text-neutral-700 [overflow-wrap:anywhere]">
          Abgestimmt: {ergebnis.antworten.map((a) => a.name).join(', ')}
        </p>
      {/if}
    {:else if alles && ansicht === 'tabelle'}
      <AbstimmungMatrix {ergebnis} />
    {:else}
      <ul class="divide-y divide-neutral-200 border-b border-neutral-200">
        {#each ergebnis.optionen as option (option.id)}
          {@const leute = namen.get(option.id) ?? { ja: [], vielleicht: [] }}
          <li class="py-3">
            <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p class="min-w-0 font-semibold text-brand-900 [overflow-wrap:anywhere]">
                {option.text}
              </p>
              <p class="flex flex-wrap items-center gap-x-2 text-sm text-neutral-700">
                {#if vorne.has(option.id)}<StatusLabel label="Meiste Stimmen" tone="success" />{/if}
                <span>{stimmenText(option.stimmen)}</span>
                {#if option.vielleicht > 0}<span>· {option.vielleicht} vielleicht</span>{/if}
              </p>
            </div>
            <div
              class="mt-2 flex h-2 overflow-hidden rounded-full bg-neutral-200"
              role="img"
              aria-label="{prozent(option.stimmen)} Prozent Ja{option.vielleicht > 0
                ? `, ${prozent(option.vielleicht)} Prozent Vielleicht`
                : ''}"
            >
              <div class="h-full bg-action" style:width="{prozent(option.stimmen)}%"></div>
              <div
                class="h-full bg-action opacity-40"
                style:width="{prozent(option.vielleicht)}%"
              ></div>
            </div>
            {#if leute.ja.length > 0}
              <p class="mt-1 text-sm text-neutral-700 [overflow-wrap:anywhere]">
                {leute.ja.join(', ')}
              </p>
            {/if}
            {#if leute.vielleicht.length > 0}
              <p class="mt-1 text-sm text-neutral-700 [overflow-wrap:anywhere]">
                Vielleicht: {leute.vielleicht.join(', ')}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
      {#if alles && keine.length > 0}
        <p class="pt-2 text-sm text-neutral-700 [overflow-wrap:anywhere]">
          Keine Option passt: {keine.map((a) => a.name).join(', ')}
        </p>
      {:else if ergebnis.einsicht === 'namen'}
        <p class="pt-2 text-sm text-neutral-700 [overflow-wrap:anywhere]">
          Abgestimmt: {ergebnis.antworten.map((a) => a.name).join(', ')}
        </p>
      {/if}
    {/if}
  {/if}
</section>
