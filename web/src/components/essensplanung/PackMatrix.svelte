<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { fuerText, type PackZeile } from '../../lib/essensplanungPackliste';
  import { naechsteZelle, type PackZelle } from '../../lib/essensplanungPackMatrix';
  import {
    anteil,
    packSpalten,
    spaltenSumme,
    type PackSpalte,
  } from '../../lib/essensplanungPackSpalten';
  import { anteilAbhaken, packAbhaken, packSenden, personenErfolg } from './packSpeichern';
  import type { PlanKontext } from './planKontext';

  /**
   * The packing list as a matrix: the persons across, the things down. The cell of a person who
   * packs a thing is their own box; a click in an empty cell makes them pack it too. „Wer
   * packt?“ at the thing chooses anew, also to take someone off. The box in the column
   * „Gepackt“ packs a thing with at most one person; with several it counts their boxes. The
   * focus moves with the arrow keys like in a spreadsheet; Space or Enter acts on the cell.
   */

  interface Props {
    kontext: PlanKontext;
    /** All rows, for the columns and their sums. */
    zeilen: PackZeile[];
    /** The rows of the filter. */
    sichtbar: PackZeile[];
    bearbeiten: boolean;
    /** Opens the choice of who packs a row. */
    onwer: (zeile: PackZeile) => void;
  }
  let { kontext, zeilen, sichtbar, bearbeiten, onwer }: Props = $props();

  const spalten = $derived(packSpalten(kontext.ansicht.mitglieder, zeilen));
  const gepacktGesamt = $derived(zeilen.filter((zeile) => zeile.gepackt).length);
  /** Rows whose change is being saved; a click there waits. */
  const laeuft = new SvelteSet<string>();
  /** Cells before the persons: the thing (with „Wer packt?“) and „Gepackt“. */
  const VORNE = 2;

  /** The cell reached with Tab; the arrows move it. */
  let aktiv = $state<PackZelle>({ zeile: 0, spalte: 1 });
  const tabZelle = $derived({
    zeile: Math.min(aktiv.zeile, Math.max(sichtbar.length - 1, 0)),
    spalte: Math.min(aktiv.spalte, spalten.length + VORNE - 1),
  });
  const tabindex = (z: number, s: number): number =>
    tabZelle.zeile === z && tabZelle.spalte === s ? 0 : -1;
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
    const naechste = naechsteZelle(
      { zeile, spalte },
      event,
      sichtbar.length,
      spalten.length + VORNE
    );
    if (!naechste) return;
    event.preventDefault();
    aktiv = naechste;
    zelle(naechste)?.focus();
  }

  const zeileVon = (zeile: PackZeile): PackZeile =>
    zeilen.find((z) => z.key === zeile.key) ?? zeile;

  /** Runs one change of a row at a time; a click while one runs puts the box back. */
  async function einzeln(
    zeile: PackZeile,
    arbeit: (jetzt: PackZeile) => Promise<boolean>,
    feld?: HTMLInputElement
  ): Promise<void> {
    if (laeuft.has(zeile.key)) {
      if (feld) feld.checked = !feld.checked;
      return;
    }
    laeuft.add(zeile.key);
    await arbeit(zeileVon(zeile));
    laeuft.delete(zeile.key);
  }

  function packen(zeile: PackZeile, feld: HTMLInputElement): void {
    const gepackt = feld.checked;
    void einzeln(
      zeile,
      async (jetzt) => {
        const ok = await packAbhaken(kontext, jetzt, gepackt);
        if (!ok) feld.checked = zeileVon(zeile).gepackt;
        return ok;
      },
      feld
    );
  }

  function anteilPacken(zeile: PackZeile, spalte: PackSpalte, feld: HTMLInputElement): void {
    const gepackt = feld.checked;
    void einzeln(
      zeile,
      async (jetzt) => {
        const person = anteil(jetzt, spalte.key);
        if (!person) return false;
        const ok = await anteilAbhaken(kontext, jetzt, person, gepackt);
        if (!ok) feld.checked = anteil(zeileVon(zeile), spalte.key)?.gepackt ?? false;
        return ok;
      },
      feld
    );
  }

  /** Adds the column's person to a row; a member without access gets nothing new. */
  function zuteilen(zeile: PackZeile, spalte: PackSpalte): void {
    if (spalte.ohneZugang) return;
    void einzeln(zeile, async (jetzt) => {
      if (anteil(jetzt, spalte.key)) return true;
      const felder =
        spalte.mitgliedId !== null ? { mitglieder: [spalte.mitgliedId] } : { namen: [spalte.name] };
      const erfolg = personenErfolg(jetzt.name, [spalte.name], [], jetzt.personen.length + 1);
      return (await packSenden(kontext, jetzt, felder, erfolg)).ok;
    });
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

  const zellKnopf =
    'flex size-full min-h-8 any-pointer-coarse:min-h-11 min-w-8 any-pointer-coarse:min-w-11 items-center justify-center';
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
        {@const mehrere = zeile.personen.length > 1}
        {@const gepacktAnzahl = zeile.personen.filter((p) => p.gepackt).length}
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
            {#if bearbeiten}
              <button
                type="button"
                data-zelle="{z}:0"
                tabindex={tabindex(z, 0)}
                class="min-h-8 any-pointer-coarse:min-h-11 text-xs font-semibold text-brand-900 underline"
                aria-label="Wer packt {zeile.name} ein?"
                onclick={() => onwer(zeileVon(zeile))}>Wer packt?</button
              >
            {/if}
          </th>
          <td
            class="border-b border-neutral-200 text-center {zeile.gepackt ? 'bg-success-soft' : ''}"
          >
            {#if bearbeiten && !mehrere}
              <label class="{zellKnopf} cursor-pointer">
                <input
                  type="checkbox"
                  class="size-4 any-pointer-coarse:size-5"
                  data-zelle="{z}:1"
                  tabindex={tabindex(z, 1)}
                  aria-label="{zeile.name} gepackt"
                  checked={zeile.gepackt}
                  onchange={(event) => packen(zeile, event.currentTarget)}
                />
              </label>
            {:else}
              {@const stand = zeile.gepackt
                ? '✓ gepackt'
                : mehrere
                  ? `${gepacktAnzahl} von ${zeile.personen.length}`
                  : 'offen'}
              {#if bearbeiten}
                <!-- Several persons each pack their own: the count opens who packs it -->
                <button
                  type="button"
                  data-zelle="{z}:1"
                  tabindex={tabindex(z, 1)}
                  class="{zellKnopf} px-1 text-xs font-semibold hover:bg-neutral-100 {zeile.gepackt
                    ? 'text-success'
                    : 'text-neutral-700'}"
                  aria-label="Wer packt {zeile.name} ein? {gepacktAnzahl} von {zeile.personen
                    .length} gepackt"
                  onclick={() => onwer(zeileVon(zeile))}
                  >{zeile.gepackt ? '✓ ' : ''}{gepacktAnzahl} von {zeile.personen.length}</button
                >
              {:else}
                <span
                  class="px-1 text-xs font-semibold {zeile.gepackt
                    ? 'text-success'
                    : 'text-neutral-700'}">{stand}</span
                >
              {/if}
            {/if}
          </td>
          {#each spalten as spalte, s (spalte.key)}
            {@const person = anteil(zeile, spalte.key)}
            <td
              class="border-b border-l border-neutral-200 p-0 text-center {person
                ? person.gepackt
                  ? 'bg-success-soft'
                  : 'bg-brand-50'
                : ''}"
            >
              {#if bearbeiten && person}
                <label class="{zellKnopf} cursor-pointer">
                  <input
                    type="checkbox"
                    class="size-4 any-pointer-coarse:size-5"
                    data-zelle="{z}:{s + VORNE}"
                    tabindex={tabindex(z, s + VORNE)}
                    aria-label="{spalte.name} hat {zeile.name} gepackt"
                    checked={person.gepackt}
                    onchange={(event) => anteilPacken(zeile, spalte, event.currentTarget)}
                  />
                </label>
              {:else if bearbeiten}
                <button
                  type="button"
                  data-zelle="{z}:{s + VORNE}"
                  tabindex={tabindex(z, s + VORNE)}
                  class="{zellKnopf} text-neutral-400 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:-outline-offset-2 {spalte.ohneZugang
                    ? 'cursor-not-allowed'
                    : ''}"
                  aria-disabled={spalte.ohneZugang ? 'true' : undefined}
                  aria-label="{spalte.name} packt {zeile.name} ein"
                  onclick={() => zuteilen(zeile, spalte)}
                >
                  <span aria-hidden="true">○</span>
                </button>
              {:else if person}
                <span class="font-semibold {person.gepackt ? 'text-success' : 'text-brand-900'}"
                  >{person.gepackt ? '✓' : '●'}<span class="sr-only"
                    >{spalte.name} packt {zeile.name} ein{person.gepackt ? ', gepackt' : ''}</span
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
