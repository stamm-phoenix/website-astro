<script lang="ts">
  import { kochMenge, zeilenMenge } from '../../lib/essensplanungRechnung';
  import type { esserRechner } from '../../lib/essensplanungRechnung';
  import { zahlText } from '../../lib/essensplanungTeilnehmende';
  import { fuerText } from '../../lib/essensplanungGerichte';
  import type { Einplanung, PlanungMahlzeit } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /**
   * The amounts of a planned dish at its meal, scaled to who eats there. Folded on the screen,
   * always on paper, so the printed plan is the kitchen's list.
   */

  interface Props {
    kontext: PlanKontext;
    mahlzeit: PlanungMahlzeit;
    einplanung: Einplanung;
    /** Name of the dish, for the labels. */
    name: string;
    esser: ReturnType<typeof esserRechner>;
    /** Names of the intolerances; empty while not loaded. */
    unvertraeglichkeiten: Map<number, string>;
  }
  let { kontext, mahlzeit, einplanung, name, esser, unvertraeglichkeiten }: Props = $props();

  /** „Gluten, Ei“; a name not loaded says so, so a line never reads as if for everyone. */
  const namen = (ids: number[]) =>
    ids
      .map((id) => unvertraeglichkeiten.get(id) ?? 'Unverträglichkeit (Name nicht geladen)')
      .join(', ');

  const ALLE = { fuerAlles: true, fuerVegetarisch: true, fuerVegan: true, ohne: [], nur: [] };

  const gericht = $derived(kontext.ansicht.gerichte.find((g) => g.id === einplanung.gerichtId));
  const zutaten = $derived(new Map(kontext.ansicht.zutaten.map((z) => [z.id, z])));
  /** The portions of the meal: everybody who eats there, weighted. */
  const portionen = $derived(esser(mahlzeit, ALLE));

  interface Zeile {
    id: number;
    name: string;
    menge: string;
    /** For whom the line is (diet, intolerances), its portions when fewer, or fixed. */
    fuer: string;
    hinweis: string;
  }

  const zeilen = $derived<Zeile[]>(
    (gericht?.zutaten ?? []).map((zeile) => {
      const zutat = zutaten.get(zeile.planungZutatId);
      const wer = zeile.fest ? 0 : esser(mahlzeit, zeile);
      const menge = gericht ? zeilenMenge(zeile, gericht.personen, wer, einplanung.faktor) : null;
      return {
        id: zeile.id,
        name: zutat?.name ?? 'Zutat',
        menge:
          menge === null || zeile.einheit === null
            ? 'nach Gefühl'
            : kochMenge(menge, zeile.einheit, zutat?.abtropfgewicht),
        // Like the card of the dish, so two lines of one ingredient read apart
        fuer: [
          zeile.fest ? 'feste Menge' : '',
          fuerText(zeile) ?? '',
          zeile.nur.length ? `nur bei ${namen(zeile.nur)}` : '',
          zeile.ohne.length ? `nicht bei ${namen(zeile.ohne)}` : '',
          !zeile.fest && Math.abs(wer - portionen) > 0.005 ? `für ${zahlText(wer)} Portionen` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        hinweis: zeile.hinweis,
      };
    })
  );
</script>

{#snippet liste()}
  {#if !zeilen.length}
    <p class="text-sm text-neutral-700">Das Gericht hat noch keine Zutaten.</p>
  {:else}
    <ul class="text-sm" aria-label="Mengen für {name} bei {mahlzeit.kennung}">
      {#each zeilen as zeile (zeile.id)}
        <li class="[overflow-wrap:anywhere]">
          <span class="font-semibold tabular-nums">{zeile.menge}</span>
          {zeile.name}
          {#if zeile.fuer || zeile.hinweis}<span class="text-neutral-700"
              >· {[zeile.fuer, zeile.hinweis].filter(Boolean).join(' · ')}</span
            >{/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<div class="basis-full">
  <details class="print:hidden">
    <summary
      class="min-h-11 cursor-pointer py-2 text-sm font-semibold text-link"
      aria-label="Mengen von {name} für {zahlText(portionen)} Portionen"
      >Mengen für {zahlText(portionen)} Portionen</summary
    >
    {@render liste()}
  </details>
  <div class="hidden print:block">
    <p class="text-sm font-semibold">Mengen für {zahlText(portionen)} Portionen</p>
    {@render liste()}
  </div>
</div>
