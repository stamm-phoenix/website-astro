<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import EinheitFeld from './EinheitFeld.svelte';
  import { getippteZutat, zutatWahl } from '../../lib/essensplanungGerichte';
  import { mengeFuerZutat, vorschauText } from '../../lib/essensplanungKi';
  import { eigeneEinheiten } from '../../lib/essensplanungEinheiten';
  import type { EssenKatalog, PlanungAnsicht } from '../../lib/types';
  import type { Vorschlag } from '../../lib/vorschlaege';
  import { zutatVon, type VorschauZeile } from './rezeptVorschau';

  /**
   * The lines of a recipe the AI read or wrote, to check before they are taken over: each can be
   * unticked, and its ingredient, amount, unit and note changed. Unknown ingredients are marked
   * and only count once one of the lists is chosen.
   */

  interface Props {
    zeilen: VorschauZeile[];
    katalog: EssenKatalog;
    ansicht: PlanungAnsicht;
    vorschlaege: Vorschlag[];
  }
  let { zeilen = $bindable(), katalog, ansicht, vorschlaege }: Props = $props();

  function einheitenartVon(zeile: VorschauZeile) {
    return zutatVon(zeile.auswahl, ansicht.zutaten, katalog)?.einheitenart ?? null;
  }

  /** Takes the other way to give the amount, e.g. the recipe's 20 EL instead of 300 g. */
  function tausche(zeile: VorschauZeile): void {
    if (!zeile.alternative) return;
    const vorher = { menge: zeile.menge, einheit: zeile.einheit };
    zeile.menge = zeile.alternative.menge;
    zeile.einheit = zeile.alternative.einheit;
    zeile.alternative = vorher;
  }

  function waehle(zeile: VorschauZeile, option: Vorschlag): void {
    const wahl = zutatWahl(option);
    // Picking and typing the same name both land here; the second must not undo the first
    if (zeile.auswahl?.art === wahl.art && zeile.auswahl.id === wahl.id) {
      zeile.zutatText = option.value;
      return;
    }
    zeile.auswahl = wahl;
    zeile.zutatText = option.value;
    zeile.an = true;
    zeile.fehler = {};
    // Meat only for those who eat everything, as the recipe import does
    const zutat = zutatVon(zeile.auswahl, ansicht.zutaten, katalog);
    zeile.fuerAlles = true;
    zeile.fuerVegetarisch = zutat?.vegetarisch !== false;
    zeile.fuerVegan = zutat?.vegan !== false;
    if (!zutat) return;
    // Pieces become grams with the list's weight; any other unit stays, as it may
    const zentral = katalog.zutaten.find(
      (z) => z.id === ('zutatId' in zutat ? zutat.zutatId : zutat.id)
    );
    const neu = mengeFuerZutat(zeile, zutat.einheitenart, zentral?.grammProStueck ?? null);
    zeile.menge = neu.menge;
    zeile.einheit = neu.einheit;
    zeile.alternative = neu.alternative ?? zeile.alternative;
  }

  function getippt(zeile: VorschauZeile, eingabe: string): void {
    const treffer = getippteZutat(vorschlaege, eingabe);
    if (treffer) waehle(zeile, treffer);
    else {
      zeile.auswahl = null;
      zeile.an = false;
    }
  }
</script>

<ul class="divide-y divide-neutral-200 border-y border-neutral-200">
  {#each zeilen as zeile, index (index)}
    <li class="space-y-2 py-3" data-testid="rezept-zeile">
      <!-- The whole row is the touch area of the checkbox, at least 44 px high -->
      <label
        class="form-check-row min-w-0 cursor-pointer text-sm text-neutral-700 [overflow-wrap:anywhere]"
        data-testid="rezept-zeile-an"
      >
        <input
          id="rezept-{index}-an"
          type="checkbox"
          class="form-check"
          aria-label="{zeile.original} übernehmen"
          disabled={!zeile.auswahl}
          bind:checked={zeile.an}
        />
        <span>
          Rezept: {zeile.original}
          {#if zeile.auswahl && !(zeile.fuerVegetarisch && zeile.fuerVegan)}
            <span>({zeile.fuerVegetarisch ? 'nicht für vegan' : 'nur für mit allem'})</span>
          {/if}
          {#if !zeile.auswahl}
            <span class="font-semibold text-warning">– nicht in der Liste, bitte wählen</span>
          {/if}
        </span>
      </label>
      <div class="grid gap-2 sm:grid-cols-[minmax(0,2fr)_6rem_7rem_minmax(0,1.5fr)]">
        <div>
          <label class="sr-only" for="rezept-{index}-zutat">Zutat für {zeile.original}</label>
          <VorschlagFeld
            id="rezept-{index}-zutat"
            options={vorschlaege}
            bind:value={zeile.zutatText}
            listLabel="Zutaten"
            pickFirstOnEnter
            onpick={(option) => waehle(zeile, option)}
            onedit={(eingabe) => getippt(zeile, eingabe)}
            autocomplete="off"
            aria-invalid={zeile.fehler.zutat ? 'true' : undefined}
          />
          {#if zeile.fehler.zutat}<p class="text-sm text-danger">
              {zeile.fehler.zutat}
            </p>{/if}
        </div>
        <div>
          <label class="sr-only" for="rezept-{index}-menge">Menge für {zeile.original}</label>
          <input
            id="rezept-{index}-menge"
            class="form-input"
            inputmode="decimal"
            autocomplete="off"
            placeholder="Menge"
            bind:value={zeile.menge}
          />
          {#if zeile.fehler.menge}<p class="text-sm text-danger">
              {zeile.fehler.menge}
            </p>{/if}
        </div>
        <div>
          <label class="sr-only" for="rezept-{index}-einheit">Einheit für {zeile.original}</label>
          <EinheitFeld
            id="rezept-{index}-einheit"
            bind:einheit={zeile.einheit}
            art={einheitenartVon(zeile)}
            eigene={eigeneEinheiten(ansicht)}
            invalid={Boolean(zeile.fehler.einheit)}
            disabled={!zeile.menge.trim()}
          />
          {#if zeile.fehler.einheit}<p class="text-sm text-danger">
              {zeile.fehler.einheit}
            </p>{/if}
          {#if zeile.alternative}
            <ActionButton
              type="button"
              class="mt-1"
              aria-label="Für {zeile.original} stattdessen {vorschauText(
                zeile.alternative
              )} übernehmen"
              onclick={() => tausche(zeile)}>⇄ {vorschauText(zeile.alternative)}</ActionButton
            >
          {/if}
        </div>
        <div>
          <label class="sr-only" for="rezept-{index}-hinweis">Hinweis für {zeile.original}</label>
          <input
            id="rezept-{index}-hinweis"
            class="form-input"
            maxlength="100"
            placeholder="Hinweis"
            bind:value={zeile.hinweis}
          />
        </div>
      </div>
    </li>
  {/each}
</ul>
