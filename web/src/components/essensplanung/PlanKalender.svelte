<script lang="ts">
  import { tick } from 'svelte';
  import { datumKurz } from '../../lib/essensplanung';
  import type { Auftrag } from '../../lib/essensplanungEinplanung';
  import { kalenderZeilen } from '../../lib/essensplanungPlan';
  import type { esserRechner } from '../../lib/essensplanungRechnung';
  import type { PlanungMahlzeit } from '../../lib/types';
  import EinplanungKarte from './EinplanungKarte.svelte';
  import SlotEingabe from './SlotEingabe.svelte';
  import { getippt, slotEntwuerfe } from './slotEntwuerfe.svelte';
  import { ablegen, ueber, verlassen, ziehen } from './planZiehen.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The plan as a grid over the whole width: the days as columns, the meals as rows with their
   * names on the left (rows by name, so a day without breakfast leaves that cell empty). Dishes
   * are cards that can be dragged; a cell takes a typed dish. Keys like in a spreadsheet: arrows
   * move between cells, Enter or F2 (or just typing) starts a dish in the cell, Escape leaves it.
   */

  interface Props {
    kontext: PlanKontext;
    bearbeiten: boolean;
    esser: ReturnType<typeof esserRechner>;
    oneinplanen: (auftrag: Auftrag) => void;
    /** Shows amounts and what a planned dish used, which are in the list. */
    onmengen: (einplanungId: number) => void;
  }
  let { kontext, bearbeiten, esser, oneinplanen, onmengen }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const zeilen = $derived(kalenderZeilen(ansicht.tage));
  const gruppen = $derived(new Map(ansicht.gruppen.map((g) => [g.id, g.name])));

  /** „ · ohne Wö“ when groups do not eat at the meal. */
  function ohneText(mahlzeit: PlanungMahlzeit): string {
    const namen = mahlzeit.ohneGruppen.map((id) => gruppen.get(id)).filter(Boolean);
    return namen.length ? ` · ohne ${namen.join(', ')}` : '';
  }

  /** The cell that has the tab stop (roving tabindex), as row and day index. */
  let aktiv = $state({ zeile: 0, spalte: 0 });
  /** The tab stop on a cell that exists, also after others removed a day or a meal. */
  const tabStopp = $derived({
    zeile: Math.max(0, Math.min(zeilen.length - 1, aktiv.zeile)),
    spalte: Math.max(0, Math.min(ansicht.tage.length - 1, aktiv.spalte)),
  });
  const eingaben: Record<string, SlotEingabe> = $state({});

  let bereich = $state<HTMLDivElement | null>(null);
  let breiter = $state(false);
  $effect(() => {
    const element = bereich;
    if (!element) return;
    const messen = (): void => {
      breiter = element.scrollWidth > element.clientWidth + 1;
    };
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(element);
    if (element.firstElementChild) beobachter.observe(element.firstElementChild);
    return () => beobachter.disconnect();
  });

  function zelle(zeile: number, spalte: number): HTMLElement | null {
    return bereich?.querySelector(`[data-zelle="${zeile}:${spalte}"]`) ?? null;
  }

  async function gehe(zeile: number, spalte: number): Promise<void> {
    aktiv = {
      zeile: Math.max(0, Math.min(zeilen.length - 1, zeile)),
      spalte: Math.max(0, Math.min(ansicht.tage.length - 1, spalte)),
    };
    await tick();
    zelle(aktiv.zeile, aktiv.spalte)?.focus();
  }

  function taste(event: KeyboardEvent, zeile: number, spalte: number, mahlzeit?: PlanungMahlzeit) {
    // Only the cell itself; its buttons and fields keep their keys
    if (event.target !== event.currentTarget) return;
    const bewegung: Record<string, [number, number]> = {
      ArrowUp: [zeile - 1, spalte],
      ArrowDown: [zeile + 1, spalte],
      ArrowLeft: [zeile, spalte - 1],
      ArrowRight: [zeile, spalte + 1],
      Home: event.ctrlKey ? [0, 0] : [zeile, 0],
      End: event.ctrlKey
        ? [zeilen.length - 1, ansicht.tage.length - 1]
        : [zeile, ansicht.tage.length - 1],
    };
    const ziel = bewegung[event.key];
    if (ziel) {
      event.preventDefault();
      void gehe(...ziel);
      return;
    }
    if (!bearbeiten || !mahlzeit) return;
    const eingabe = eingaben[mahlzeit.id];
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      void eingabe?.oeffne();
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.key !== ' '
    ) {
      // Typing starts a dish, like typing into a cell of a spreadsheet
      event.preventDefault();
      void eingabe?.oeffne(event.key);
    }
  }
</script>

{#if breiter}
  <p class="text-sm text-neutral-700">
    Weitere Tage siehst du, wenn du seitlich wischst oder scrollst.
  </p>
{/if}
<div bind:this={bereich} class="overflow-x-auto rounded-md border border-neutral-200">
  <div
    role="grid"
    aria-label="Plan als Kalender"
    aria-rowcount={zeilen.length + 1}
    class="grid text-sm [--spalte:10.5rem] any-pointer-coarse:[--spalte:14rem]"
    style:grid-template-columns="minmax(5.5rem, 9rem) repeat({ansicht.tage.length},
    minmax(var(--spalte), 1fr))"
  >
    <div role="row" class="contents">
      <div
        role="columnheader"
        class="sticky left-0 z-10 border-r border-b border-neutral-300 bg-neutral-100 px-2 py-1.5 text-xs font-semibold text-neutral-700"
      >
        Mahlzeit
      </div>
      {#each ansicht.tage as tag (tag.id)}
        <div
          role="columnheader"
          class="border-b border-l border-neutral-300 bg-neutral-100 px-2 py-1.5 font-semibold text-brand-900"
        >
          Tag {tag.nummer}
          <span class="font-normal text-neutral-700">· {datumKurz(tag.datum)}</span>
        </div>
      {/each}
    </div>
    {#each zeilen as zeile, z (z)}
      {@const streifen = z % 2 === 1 ? 'bg-neutral-50' : 'bg-surface'}
      <div role="row" class="contents">
        <div
          role="rowheader"
          class="sticky left-0 z-10 border-r border-b border-neutral-300 px-2 py-1.5 font-semibold break-words text-brand-900 hyphens-auto {z %
            2 ===
          1
            ? 'bg-neutral-100'
            : 'bg-surface'}"
        >
          {zeile.name}
        </div>
        {#each ansicht.tage as tag, s (tag.id)}
          {@const mahlzeit = zeile.mahlzeiten.get(tag.id)}
          {@const markiert = ziehen.ziel?.mahlzeitId === mahlzeit?.id}
          <div
            role="gridcell"
            data-zelle="{z}:{s}"
            data-kalender={mahlzeit?.kennung}
            tabindex={tabStopp.zeile === z && tabStopp.spalte === s ? 0 : -1}
            aria-label={mahlzeit
              ? `${mahlzeit.kennung} ${mahlzeit.name}, ${mahlzeit.einplanungen.length} ${mahlzeit.einplanungen.length === 1 ? 'Gericht' : 'Gerichte'}`
              : `Tag ${tag.nummer}: keine Mahlzeit ${zeile.name}`}
            class="group flex min-h-16 flex-col gap-1 border-b border-l border-neutral-200 p-1 outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-brand-800 {mahlzeit
              ? markiert
                ? 'bg-brand-100'
                : streifen
              : 'bg-neutral-50 bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--color-neutral-200)_6px_7px)]'}"
            onfocusin={() => (aktiv = { zeile: z, spalte: s })}
            onkeydown={(event) => taste(event, z, s, mahlzeit)}
            ondragover={mahlzeit && bearbeiten ? (event) => ueber(event, mahlzeit) : undefined}
            ondragleave={mahlzeit ? (event) => verlassen(event, mahlzeit) : undefined}
            ondrop={mahlzeit && bearbeiten
              ? (event) => void ablegen(event, kontext, mahlzeit)
              : undefined}
          >
            {#if mahlzeit}
              <span class="px-0.5 text-[0.7rem] text-neutral-700" aria-hidden="true"
                ><span class="font-mono">{mahlzeit.kennung}</span>{ohneText(mahlzeit)}</span
              >
              {#each mahlzeit.einplanungen as einplanung, index (einplanung.id)}
                {#if markiert && ziehen.ziel?.index === index}
                  <div class="h-0.5 rounded bg-brand-800" aria-hidden="true"></div>
                {/if}
                <EinplanungKarte
                  {kontext}
                  {mahlzeit}
                  {einplanung}
                  {esser}
                  {bearbeiten}
                  variante="kalender"
                  {oneinplanen}
                  {onmengen}
                />
              {/each}
              {#if markiert && ziehen.ziel?.index === mahlzeit.einplanungen.length}
                <div class="h-0.5 rounded bg-brand-800" aria-hidden="true"></div>
              {/if}
              {#if bearbeiten || getippt(slotEntwuerfe[mahlzeit.id])}
                <div class="mt-auto">
                  <SlotEingabe
                    gesperrt={!bearbeiten}
                    bind:this={eingaben[mahlzeit.id]}
                    {kontext}
                    {mahlzeit}
                    variante="kalender"
                    knopfKlasse="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 any-pointer-coarse:opacity-100"
                    onschliessen={() => void gehe(z, s)}
                  />
                </div>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>
