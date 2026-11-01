<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { fuerText, type PackZeile } from '../../lib/essensplanungPackliste';
  import {
    NIEMAND,
    naechsteZelle,
    packSpalten,
    spalteVon,
    spaltenSumme,
    type PackSpalte,
    type PackZelle,
  } from '../../lib/essensplanungPackMatrix';
  import type { packEntwuerfe } from './packEntwuerfe.svelte';
  import { packAbhaken, packAendern, zustaendigErfolg } from './packSpeichern';
  import type { PlanKontext } from './planKontext';

  /**
   * The packing list as a matrix: the persons across, the things down. A click in a person's cell
   * says they pack it (again in the same cell: nobody), the box in the first column packs it. The
   * focus moves with the arrow keys like in a spreadsheet; Space or Enter acts on the cell. Saves
   * like the list (`packSpeichern.ts`), on the version the row was shown with.
   */

  interface Props {
    kontext: PlanKontext;
    /** All rows, for the columns and their sums. */
    zeilen: PackZeile[];
    /** The rows of the filter. */
    sichtbar: PackZeile[];
    bearbeiten: boolean;
    entwuerfe: ReturnType<typeof packEntwuerfe>;
  }
  let { kontext, zeilen, sichtbar, bearbeiten, entwuerfe }: Props = $props();

  const spalten = $derived(packSpalten(kontext.ansicht.mitglieder, zeilen));
  const gepacktGesamt = $derived(zeilen.filter((zeile) => zeile.gepackt).length);
  /** Rows whose change is being saved; a click there waits. */
  const laeuft = new SvelteSet<string>();

  /** The cell reached with Tab; the arrows move it. */
  let aktiv = $state<PackZelle>({ zeile: 0, spalte: 0 });
  const tabZelle = $derived({
    zeile: Math.min(aktiv.zeile, Math.max(sichtbar.length - 1, 0)),
    spalte: Math.min(aktiv.spalte, spalten.length),
  });
  let tabelle = $state<HTMLTableElement | null>(null);
  /** The focus was in the matrix; a row that goes with it (a filter) hands it to its neighbour. */
  let imGitter = false;

  function zelle(position: PackZelle): HTMLElement | null {
    return (
      tabelle?.querySelector<HTMLElement>(`[data-zelle="${position.zeile}:${position.spalte}"]`) ??
      null
    );
  }

  $effect(() => {
    void sichtbar;
    void spalten;
    void tick().then(() => {
      const fokus = document.activeElement;
      if (!imGitter || (fokus && fokus !== document.body)) return;
      zelle(tabZelle)?.focus();
    });
  });

  $effect(() => {
    const draussen = (event: PointerEvent): void => {
      if (!tabelle?.contains(event.target as Node)) imGitter = false;
    };
    document.addEventListener('pointerdown', draussen);
    return () => document.removeEventListener('pointerdown', draussen);
  });

  function taste(event: KeyboardEvent): void {
    const ziel = (event.target as HTMLElement).closest<HTMLElement>('[data-zelle]');
    if (!ziel) return;
    const [zeile, spalte] = ziel.dataset.zelle!.split(':').map(Number);
    if (event.key === 'Enter' && ziel instanceof HTMLInputElement) {
      // Enter packs like Space, as in the other cells
      event.preventDefault();
      ziel.click();
      return;
    }
    const naechste = naechsteZelle({ zeile, spalte }, event, sichtbar.length, spalten.length + 1);
    if (!naechste) return;
    event.preventDefault();
    aktiv = naechste;
    zelle(naechste)?.focus();
  }

  const zeileVon = (zeile: PackZeile): PackZeile =>
    zeilen.find((z) => z.key === zeile.key) ?? zeile;

  async function packen(zeile: PackZeile, feld: HTMLInputElement): Promise<void> {
    const gepackt = feld.checked;
    if (laeuft.has(zeile.key)) {
      feld.checked = !gepackt;
      return;
    }
    laeuft.add(zeile.key);
    const ok = await packAbhaken(
      kontext,
      () => zeileVon(zeile),
      gepackt,
      entwuerfe.von(zeile.key),
      entwuerfe.aktionen(zeile.key)
    );
    laeuft.delete(zeile.key);
    if (!ok) feld.checked = zeileVon(zeile).gepackt;
  }

  async function zuweisen(zeile: PackZeile, spalte: PackSpalte): Promise<void> {
    if (laeuft.has(zeile.key) || !waehlbar(zeile, spalte)) return;
    // The cell of who packs it takes it back
    const ziel = spalteVon(zeile) === spalte.key ? spalten.find((s) => s.key === NIEMAND)! : spalte;
    if (ziel.key === spalteVon(zeile) && !entwuerfe.von(zeile.key)) return;
    laeuft.add(zeile.key);
    // A free name typed at the row in the list, maybe still saving, goes first: the choice then
    // goes on the version its answer brought and replaces it
    const { ok } = await packAendern(
      kontext,
      () => zeileVon(zeile),
      (jetzt) =>
        spalteVon(jetzt) === ziel.key
          ? null
          : { zustaendigId: ziel.zustaendigId, zustaendigText: ziel.zustaendigText },
      (jetzt) => zustaendigErfolg(ziel.key === NIEMAND ? '' : ziel.name, jetzt.name),
      entwuerfe.von(zeile.key),
      entwuerfe.aktionen(zeile.key)
    );
    laeuft.delete(zeile.key);
    if (ok) entwuerfe.aktionen(zeile.key).verwerfen();
  }

  /**
   * Whether a cell can be chosen: a member without access (also one the view lacks) keeps what
   * they pack and can be taken off it, but gets nothing new.
   */
  function waehlbar(zeile: PackZeile, spalte: PackSpalte): boolean {
    return !spalte.ohneZugang || spalteVon(zeile) === spalte.key;
  }

  function summe(spalte: PackSpalte): string {
    const { gepackt, gesamt } = spaltenSumme(zeilen, spalte.key);
    return gesamt ? `${gepackt} von ${gesamt} gepackt` : 'nichts';
  }

  /** Shows the hint while the matrix is wider than the screen. */
  let bereich = $state<HTMLDivElement | null>(null);
  let breiter = $state(false);
  $effect(() => {
    const element = bereich;
    const innen = tabelle;
    if (!element || !innen) return;
    const messen = (): void => {
      breiter = element.scrollWidth > element.clientWidth + 1;
    };
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(element);
    beobachter.observe(innen);
    return () => beobachter.disconnect();
  });
</script>

{#if breiter}
  <p class="text-sm text-neutral-700">
    Weitere Personen siehst du, wenn du seitlich wischst oder scrollst.
  </p>
{/if}
<div
  bind:this={bereich}
  class="max-h-[calc(100dvh-9rem)] w-fit max-w-full scroll-pt-14 scroll-pl-36 overflow-auto border border-neutral-200 md:scroll-pl-64"
  role="region"
  aria-label="Packliste als Matrix"
>
  <table
    bind:this={tabelle}
    role="grid"
    aria-label="Packliste als Matrix"
    class="border-separate border-spacing-0 text-left text-sm"
    onkeydown={taste}
    onfocusin={(event) => {
      imGitter = true;
      const ziel = (event.target as HTMLElement).closest<HTMLElement>('[data-zelle]');
      if (ziel) {
        const [zeile, spalte] = ziel.dataset.zelle!.split(':').map(Number);
        aktiv = { zeile, spalte };
      }
    }}
  >
    <thead>
      <tr>
        <th
          scope="col"
          class="sticky top-0 left-0 z-30 w-36 min-w-36 border-r border-b border-neutral-300 bg-[var(--color-surface)] px-2 py-1 align-bottom font-semibold text-brand-900 md:w-64 md:min-w-64"
        >
          Was
        </th>
        <th
          scope="col"
          class="sticky top-0 z-20 border-b border-neutral-300 bg-[var(--color-surface)] px-2 py-1 text-center align-bottom font-semibold text-brand-900"
        >
          Gepackt
          <span class="block text-xs font-normal text-neutral-700 tabular-nums"
            >{gepacktGesamt} von {zeilen.length}</span
          >
        </th>
        {#each spalten as spalte (spalte.key)}
          <th
            scope="col"
            class="sticky top-0 z-20 w-24 min-w-24 border-b border-l border-neutral-300 bg-[var(--color-surface)] px-2 py-1 text-center align-bottom font-semibold [overflow-wrap:anywhere] text-brand-900"
          >
            {spalte.name}
            {#if spalte.ich}<span class="font-normal">(du)</span>{/if}
            {#if spalte.ohneZugang}<span class="block text-xs font-normal text-neutral-700"
                >ohne Zugang</span
              >{/if}
            <span class="block text-xs font-normal text-neutral-700 tabular-nums"
              >{summe(spalte)}</span
            >
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each sichtbar as zeile, z (zeile.key)}
        {@const fuer = fuerText(zeile)}
        {@const wer = spalteVon(zeile)}
        <tr class="group">
          <th
            scope="row"
            class="sticky left-0 z-10 w-36 max-w-36 border-r border-b border-neutral-200 bg-[var(--color-surface)] px-2 py-0.5 font-normal md:w-64 md:max-w-64"
          >
            <span
              class="block font-semibold [overflow-wrap:anywhere] {zeile.gepackt
                ? 'text-neutral-700 line-through'
                : ''}">{zeile.name}</span
            >
            {#if fuer}
              <span class="block truncate text-xs text-neutral-700" title="für {fuer}"
                >für {fuer}</span
              >
            {/if}
          </th>
          <td
            class="border-b border-neutral-200 text-center {zeile.gepackt ? 'bg-success-soft' : ''}"
          >
            {#if bearbeiten}
              <label
                class="flex min-h-8 any-pointer-coarse:min-h-11 min-w-8 any-pointer-coarse:min-w-11 cursor-pointer items-center justify-center"
              >
                <input
                  type="checkbox"
                  class="size-4 any-pointer-coarse:size-5"
                  data-zelle="{z}:0"
                  tabindex={tabZelle.zeile === z && tabZelle.spalte === 0 ? 0 : -1}
                  aria-label="{zeile.name} gepackt"
                  checked={zeile.gepackt}
                  onchange={(event) => void packen(zeile, event.currentTarget)}
                />
              </label>
            {:else}
              <span
                class="text-xs font-semibold {zeile.gepackt ? 'text-success' : 'text-neutral-700'}"
                >{zeile.gepackt ? '✓ gepackt' : 'offen'}</span
              >
            {/if}
          </td>
          {#each spalten as spalte, s (spalte.key)}
            {@const zugewiesen = wer === spalte.key}
            <td
              class="border-b border-l border-neutral-200 p-0 text-center {zugewiesen
                ? zeile.gepackt
                  ? 'bg-success-soft'
                  : 'bg-brand-50'
                : ''}"
            >
              {#if bearbeiten}
                <button
                  type="button"
                  data-zelle="{z}:{s + 1}"
                  tabindex={tabZelle.zeile === z && tabZelle.spalte === s + 1 ? 0 : -1}
                  class="flex size-full min-h-8 any-pointer-coarse:min-h-11 min-w-8 any-pointer-coarse:min-w-11 items-center justify-center font-semibold hover:bg-neutral-100 focus-visible:outline-2 focus-visible:-outline-offset-2 {zugewiesen
                    ? zeile.gepackt
                      ? 'text-success'
                      : 'text-brand-900'
                    : 'text-neutral-400'} {waehlbar(zeile, spalte) ? '' : 'cursor-not-allowed'}"
                  aria-pressed={zugewiesen}
                  aria-disabled={waehlbar(zeile, spalte) ? undefined : 'true'}
                  aria-label="{spalte.name} packt {zeile.name} ein"
                  onclick={() => void zuweisen(zeile, spalte)}
                >
                  {#if zugewiesen}{zeile.gepackt ? '✓' : '●'}{:else}<span aria-hidden="true">○</span
                    >{/if}
                </button>
              {:else if zugewiesen}
                <span class="font-semibold {zeile.gepackt ? 'text-success' : 'text-brand-900'}"
                  >{zeile.gepackt ? '✓' : '●'}<span class="sr-only"
                    >{spalte.name} packt {zeile.name} ein</span
                  ></span
                >
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
