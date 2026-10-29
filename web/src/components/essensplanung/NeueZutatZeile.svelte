<script lang="ts" module>
  import type { GerichtEinheit as Einheit } from '../../lib/types';

  /**
   * What is typed in the new row. Kept by the card, so it outlives the row while the page is
   * read-only for a while, e.g. in maintenance.
   */
  export interface NeueZeile {
    name: string;
    menge: string;
    einheit: Einheit;
    hinweis: string;
  }

  export function leereZeile(): NeueZeile {
    return { name: '', menge: '', einheit: 'g', hinweis: '' };
  }

  export function angefangen(zeile: NeueZeile): boolean {
    return zeile.name.trim() !== '' || zeile.menge.trim() !== '' || zeile.hinweis.trim() !== '';
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import {
    getippteZutat,
    gewaehlteZutat,
    leseMenge,
    zutatVorschlaege,
    zutatWahl,
    type ZutatWahl,
  } from '../../lib/essensplanungGerichte';
  import { EINHEITEN_JE_ART, einheitText } from '../../../../api/lib/essen-gerichte-model';
  import type { EssenKatalog, Gericht, GerichtEinheit } from '../../lib/types';
  import type { Vorschlag } from '../../lib/vorschlaege';
  import type { PlanKontext } from './planKontext';
  import type { ZeilenVorgabe } from './GerichtZeileDialog.svelte';

  /**
   * The empty row at the end of a dish: ingredient, amount, unit and note typed in one go, like a
   * new row in a sheet. Enter adds the line and starts the next one. A name not in the list and
   * the rest (for whom, intolerances, fixed) go to the dialog behind „Mehr Angaben …“.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog;
    gericht: Gericht;
    /** What is typed; the card keeps it and guards it against leaving the page. */
    eingabe: NeueZeile;
    /** Opens the dialog for a new line with what was typed. */
    onmehr: (vorgabe: ZeilenVorgabe) => void;
  }
  let { kontext, katalog, gericht, eingabe = $bindable(), onmehr }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  let fehler = $state<string | null>(null);
  let speichert = $state(false);
  let zutatFeld = $state<HTMLInputElement | null>(null);

  const vorschlaege = $derived(zutatVorschlaege(katalog, ansicht.zutaten));
  // A name typed before the row went away counts as chosen again
  let auswahl = $state<ZutatWahl | null>(null);
  $effect.pre(() => {
    const treffer = eingabe.name ? getippteZutat(vorschlaege, eingabe.name) : undefined;
    if (treffer && !auswahl) auswahl = zutatWahl(treffer);
  });
  const gewaehlt = $derived(gewaehlteZutat(auswahl, ansicht.zutaten, katalog));
  const passend = $derived.by((): readonly GerichtEinheit[] => {
    const art = gewaehlt?.einheitenart;
    return art ? EINHEITEN_JE_ART[art] : [];
  });
  /** Tins and jars are weighed drained, shown as „g (ATG)“ like on the saved line. */
  const abtropfgewicht = $derived(gewaehlt?.abtropfgewicht ?? false);
  /** A unit no longer fitting stays choosable, so a typed amount does not change its meaning. */
  const einheiten = $derived(
    passend.length && eingabe.menge.trim() && !passend.includes(eingabe.einheit)
      ? [...passend, eingabe.einheit]
      : passend
  );
  const unpassend = $derived(passend.length > 0 && !passend.includes(eingabe.einheit));
  // Without an amount the unit follows the ingredient, e.g. g for flour, Stück for eggs
  $effect(() => {
    if (!eingabe.menge.trim() && unpassend) eingabe.einheit = passend[0];
  });
  const ohneTreffer = $derived(!auswahl && eingabe.name.trim().length > 1);
  /** Picking an ingredient picks a fitting unit, as nothing typed is reinterpreted by it. */
  function nimm(option: Vorschlag): void {
    auswahl = zutatWahl(option);
    fehler = null;
    if (passend.length && !passend.includes(eingabe.einheit)) eingabe.einheit = passend[0];
  }

  function waehle(option: Vorschlag): void {
    eingabe.name = option.value;
    nimm(option);
  }

  /** A typed name of the list counts as chosen; the text stays as typed. */
  function getippt(text: string): void {
    const treffer = getippteZutat(vorschlaege, text);
    if (treffer) nimm(treffer);
    else auswahl = null;
  }

  async function hinzufuegen(): Promise<void> {
    if (speichert) return;
    fehler = null;
    const zahl = leseMenge(eingabe.menge);
    if (!auswahl) {
      fehler = eingabe.name.trim()
        ? `„${eingabe.name.trim()}“ steht nicht in der Liste. Lege sie über „Mehr Angaben …“ als eigene Zutat an.`
        : 'Bitte eine Zutat aus der Liste wählen.';
      return;
    }
    if (Number.isNaN(zahl)) {
      fehler = 'Bitte eine Zahl wie 1,5 eintragen oder leer lassen.';
      return;
    }
    if (zahl !== null && unpassend) {
      fehler = `${einheitText(eingabe.einheit)} passt nicht mehr zu ${eingabe.name.trim()}. Bitte wähle eine andere Einheit.`;
      return;
    }
    const ziel = auswahl;
    const name = eingabe.name.trim();
    const { einheit, hinweis } = eingabe;
    speichert = true;
    const ok = await kontext.aendern(
      () =>
        kontext.api.senden('POST', `/gerichte/${gericht.id}/zutaten`, {
          ...(ziel.art === 'planung' ? { planungZutatId: ziel.id } : { zutatId: ziel.id }),
          menge: zahl,
          einheit: zahl === null ? null : einheit,
          fest: false,
          fuerAlles: true,
          fuerVegetarisch: true,
          fuerVegan: true,
          ohne: [],
          nur: [],
          hinweis: hinweis.trim(),
        }),
      `${name} hinzugefügt.`
    );
    speichert = false;
    if (!ok) {
      fehler = kontext.fehler;
      return;
    }
    // The next line starts right away, as in a sheet
    eingabe = leereZeile();
    auswahl = null;
    // The field is enabled again only after the update
    await tick();
    zutatFeld?.focus();
  }

  /**
   * Enter in the name adds the line once an ingredient is chosen, also without an amount. When
   * the field takes a suggestion with this Enter, it says so by `preventDefault`.
   */
  function namenTaste(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    queueMicrotask(() => {
      if (!event.defaultPrevented && auswahl) void hinzufuegen();
    });
  }

  function taste(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void hinzufuegen();
    }
  }
</script>

<div class="space-y-1 border-t border-neutral-200 pt-2 print:hidden">
  <div
    class="grid grid-cols-[5rem_6.5rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[minmax(0,1.4fr)_5rem_6.5rem_minmax(0,1fr)_auto]"
    role="group"
    aria-label="Neue Zeile für {gericht.name}"
  >
    <label class="sr-only" for="gericht-{gericht.id}-neu-zutat">Neue Zutat für {gericht.name}</label
    >
    <VorschlagFeld
      id="gericht-{gericht.id}-neu-zutat"
      wrapperClass="col-span-3 sm:col-span-1"
      options={vorschlaege}
      bind:value={eingabe.name}
      bind:input={zutatFeld}
      listLabel="Zutaten"
      placeholder="Neue Zutat, z. B. Nudeln"
      pickFirstOnEnter
      disabled={speichert}
      onpick={waehle}
      onedit={getippt}
      onkeydown={namenTaste}
    />
    <label class="sr-only" for="gericht-{gericht.id}-neu-menge">Menge der neuen Zutat</label>
    <input
      id="gericht-{gericht.id}-neu-menge"
      class="form-input tabular-nums"
      inputmode="decimal"
      placeholder="Menge"
      disabled={speichert}
      bind:value={eingabe.menge}
      onkeydown={taste}
    />
    <label class="sr-only" for="gericht-{gericht.id}-neu-einheit">Einheit der neuen Zutat</label>
    <select
      id="gericht-{gericht.id}-neu-einheit"
      class="form-input"
      bind:value={eingabe.einheit}
      disabled={speichert || !einheiten.length}
      onkeydown={taste}
    >
      {#each einheiten as wert (wert)}
        <option value={wert}>{einheitText(wert, abtropfgewicht)}</option>
      {/each}
    </select>
    <label class="sr-only" for="gericht-{gericht.id}-neu-hinweis">Hinweis zur neuen Zutat</label>
    <input
      id="gericht-{gericht.id}-neu-hinweis"
      class="form-input"
      maxlength="100"
      placeholder="Hinweis"
      disabled={speichert}
      bind:value={eingabe.hinweis}
      onkeydown={taste}
    />
    <div class="col-span-3 flex flex-wrap gap-1 sm:col-span-1">
      <ActionButton
        type="button"
        variant="primary"
        aria-label="Zeile zu {gericht.name} hinzufügen"
        disabled={speichert || kontext.busy}
        onclick={() => void hinzufuegen()}>Hinzufügen</ActionButton
      >
      <ActionButton
        type="button"
        disabled={speichert}
        onclick={() => {
          const vorgabe = {
            name: eingabe.name.trim(),
            menge: eingabe.menge.trim(),
            einheit: einheiten.length ? eingabe.einheit : null,
            hinweis: eingabe.hinweis.trim(),
          };
          eingabe = leereZeile();
          auswahl = null;
          onmehr(vorgabe);
        }}>Mehr Angaben …</ActionButton
      >
    </div>
  </div>
  {#if fehler}
    <p class="text-sm text-danger" role="alert">{fehler}</p>
  {:else if ohneTreffer}
    <p class="text-sm text-neutral-700">
      „{eingabe.name.trim()}“ steht nicht in der Liste. Über „Mehr Angaben …“ legst du sie als
      eigene Zutat an.
    </p>
  {/if}
</div>
