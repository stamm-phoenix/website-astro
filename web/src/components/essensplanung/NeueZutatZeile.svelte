<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import {
    getippteZutat,
    leseMenge,
    zutatVorschlaege,
    zutatWahl,
    type ZutatWahl,
  } from '../../lib/essensplanungGerichte';
  import { EINHEITEN_JE_ART, einheitText } from '../../../../api/lib/essen-gerichte-model';
  import type { EssenKatalog, Gericht, GerichtEinheit } from '../../lib/types';
  import type { Vorschlag } from '../../lib/vorschlaege';
  import { meldeVerloren, type PlanKontext } from './planKontext';
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
    /** Opens the dialog for a new line with what was typed. */
    onmehr: (vorgabe: ZeilenVorgabe) => void;
  }
  let { kontext, katalog, gericht, onmehr }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  let zutatText = $state('');
  let auswahl = $state<ZutatWahl | null>(null);
  let menge = $state('');
  let einheit = $state<GerichtEinheit>('g');
  let hinweis = $state('');
  let fehler = $state<string | null>(null);
  let speichert = $state(false);
  let zutatFeld = $state<HTMLInputElement | null>(null);

  const vorschlaege = $derived(zutatVorschlaege(katalog, ansicht.zutaten));
  const einheiten = $derived.by((): readonly GerichtEinheit[] => {
    if (!auswahl) return [];
    const id = auswahl.id;
    const art =
      auswahl.art === 'planung'
        ? ansicht.zutaten.find((z) => z.id === id)?.einheitenart
        : katalog.zutaten.find((z) => z.id === id)?.einheitenart;
    return art ? EINHEITEN_JE_ART[art] : [];
  });
  // The unit follows the chosen ingredient, e.g. g for flour, Stück for eggs
  $effect(() => {
    if (einheiten.length && !einheiten.includes(einheit)) einheit = einheiten[0];
  });
  const ohneTreffer = $derived(!auswahl && zutatText.trim().length > 1);
  const angefangen = $derived(
    zutatText.trim() !== '' || menge.trim() !== '' || hinweis.trim() !== ''
  );
  $effect(() => guardUnsavedChanges(() => angefangen));
  // Someone else deleted the dish: the row goes, so the unsaved input is shown to copy
  $effect(() => () => {
    if (!angefangen) return;
    const id = gericht.id;
    const eingabe = [
      zutatText.trim(),
      menge.trim() ? `${menge.trim()} ${einheitText(einheit)}` : '',
      hinweis.trim(),
    ]
      .filter(Boolean)
      .join(', ');
    const text = `Neue Zeile für „${gericht.name}“: ${eingabe}.`;
    // Checked after the update, as during it the view may still be the old one
    setTimeout(() => {
      if (!kontext.ansicht.gerichte.some((g) => g.id === id)) meldeVerloren(kontext, text);
    });
  });

  function nimm(option: Vorschlag): void {
    auswahl = zutatWahl(option);
    fehler = null;
  }

  function waehle(option: Vorschlag): void {
    nimm(option);
    zutatText = option.value;
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
    const zahl = leseMenge(menge);
    if (!auswahl) {
      fehler = zutatText.trim()
        ? `„${zutatText.trim()}“ steht nicht in der Liste. Lege sie über „Mehr Angaben …“ als eigene Zutat an.`
        : 'Bitte eine Zutat aus der Liste wählen.';
      return;
    }
    if (Number.isNaN(zahl)) {
      fehler = 'Bitte eine Zahl wie 1,5 eintragen oder leer lassen.';
      return;
    }
    const ziel = auswahl;
    const name = zutatText.trim();
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
    zutatText = '';
    auswahl = null;
    menge = '';
    hinweis = '';
    // The field is enabled again only after the update
    await tick();
    zutatFeld?.focus();
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
      bind:value={zutatText}
      bind:input={zutatFeld}
      listLabel="Zutaten"
      placeholder="Neue Zutat, z. B. Nudeln"
      pickFirstOnEnter
      disabled={speichert}
      onpick={waehle}
      onedit={getippt}
    />
    <label class="sr-only" for="gericht-{gericht.id}-neu-menge">Menge der neuen Zutat</label>
    <input
      id="gericht-{gericht.id}-neu-menge"
      class="form-input tabular-nums"
      inputmode="decimal"
      placeholder="Menge"
      disabled={speichert}
      bind:value={menge}
      onkeydown={taste}
    />
    <label class="sr-only" for="gericht-{gericht.id}-neu-einheit">Einheit der neuen Zutat</label>
    <select
      id="gericht-{gericht.id}-neu-einheit"
      class="form-input"
      bind:value={einheit}
      disabled={speichert || !einheiten.length}
      onkeydown={taste}
    >
      {#each einheiten as wert (wert)}
        <option value={wert}>{einheitText(wert)}</option>
      {/each}
    </select>
    <label class="sr-only" for="gericht-{gericht.id}-neu-hinweis">Hinweis zur neuen Zutat</label>
    <input
      id="gericht-{gericht.id}-neu-hinweis"
      class="form-input"
      maxlength="100"
      placeholder="Hinweis"
      disabled={speichert}
      bind:value={hinweis}
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
            name: zutatText.trim(),
            menge: menge.trim(),
            einheit: einheiten.length ? einheit : null,
            hinweis: hinweis.trim(),
          };
          zutatText = '';
          auswahl = null;
          menge = '';
          hinweis = '';
          onmehr(vorgabe);
        }}>Mehr Angaben …</ActionButton
      >
    </div>
  </div>
  {#if fehler}
    <p class="text-sm text-danger" role="alert">{fehler}</p>
  {:else if ohneTreffer}
    <p class="text-sm text-neutral-700">
      „{zutatText.trim()}“ steht nicht in der Liste. Über „Mehr Angaben …“ legst du sie als eigene
      Zutat an.
    </p>
  {/if}
</div>
