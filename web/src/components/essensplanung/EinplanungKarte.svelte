<script lang="ts" module>
  /** A planned dish to unfold in the list, e.g. asked for from the calendar. */
  export const aufklappen = $state<{ id: number | null }>({ id: null });
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import AufklappPfeil from '../ui/AufklappPfeil.svelte';
  import { einplanungKennung, faktorText } from '../../lib/essensplanungEinplanung';
  import type { Auftrag } from '../../lib/essensplanungEinplanung';
  import { nachbarPlatz, type Richtung } from '../../lib/essensplanungPlan';
  import { personenFehlen, type esserRechner } from '../../lib/essensplanungRechnung';
  import { zahlText } from '../../lib/essensplanungTeilnehmende';
  import type { Einplanung, PlanungMahlzeit } from '../../lib/types';
  import EinplanungAbhaken from './EinplanungAbhaken.svelte';
  import EinplanungMengen from './EinplanungMengen.svelte';
  import { KNOPF, gerichtName, nimmHeraus, setzeStatus, verschiebe } from './planAktionen';
  import { beende, starte } from './planZiehen.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * A planned dish in the plan: a checkbox „gekocht“ (ticked with the planned amounts in one
   * click), ID, name (opens the dish), portions and who is responsible. The arrow unfolds the
   * actions; in the list also the amounts and what it used. It can be dragged to another meal;
   * Alt and an arrow key move it, with Shift a copy, Delete takes it out.
   */

  interface Props {
    kontext: PlanKontext;
    mahlzeit: PlanungMahlzeit;
    einplanung: Einplanung;
    esser: ReturnType<typeof esserRechner>;
    bearbeiten: boolean;
    variante: 'liste' | 'kalender';
    /** Names of the intolerances, for the amounts in the list. */
    unvertraeglichkeiten?: Map<number, string>;
    /** Opens the dialog to change or copy the planned dish. */
    oneinplanen: (auftrag: Auftrag) => void;
    /** In the calendar: shows amounts and what it used, which are in the list. */
    onmengen?: (einplanungId: number) => void;
  }
  let {
    kontext,
    mahlzeit,
    einplanung,
    esser,
    bearbeiten,
    variante,
    unvertraeglichkeiten = new Map(),
    oneinplanen,
    onmengen,
  }: Props = $props();

  const ALLE = { fuerAlles: true, fuerVegetarisch: true, fuerVegan: true, ohne: [], nur: [] };
  const gericht = $derived(kontext.ansicht.gerichte.find((g) => g.id === einplanung.gerichtId));
  const name = $derived(gerichtName(kontext.ansicht, einplanung));
  const kennung = $derived(einplanungKennung(mahlzeit, einplanung.id));
  const portionen = $derived(esser(mahlzeit, ALLE) * einplanung.faktor);
  const fehlt = $derived(gericht ? personenFehlen(gericht) : false);
  const kalender = $derived(variante === 'kalender');

  let offen = $state(false);
  let wurzel = $state<HTMLElement | null>(null);

  // Asked to unfold from the calendar: open and show it
  $effect(() => {
    if (variante !== 'liste' || aufklappen.id !== einplanung.id) return;
    aufklappen.id = null;
    offen = true;
    void tick().then(() => {
      wurzel?.scrollIntoView({ block: 'center' });
      wurzel?.querySelector<HTMLElement>('[data-gericht-name]')?.focus({ preventScroll: true });
    });
  });

  /** Ticks off „gekocht“ with the planned amounts, or sets it open again. */
  async function haken(event: Event): Promise<void> {
    const feld = event.currentTarget as HTMLInputElement;
    const an = feld.checked;
    const ok = await setzeStatus(kontext, mahlzeit, einplanung, an ? 'gekocht' : 'offen', esser);
    // A failed save leaves the box as it is saved, not as it was clicked
    if (!ok) feld.checked = einplanung.status === 'gekocht';
  }

  /** Puts the focus back on the dish after it moved, where it is drawn anew. */
  async function fokussiere(id: number): Promise<void> {
    await tick();
    document.querySelector<HTMLElement>(`[data-einplanung="${id}"] [data-gericht-name]`)?.focus();
  }

  const RICHTUNG: Record<string, Richtung> = {
    ArrowUp: 'hoch',
    ArrowDown: 'runter',
    ArrowLeft: 'links',
    ArrowRight: 'rechts',
  };

  /** Moves the dish one place on, like Alt and an arrow key; with `kopie` a copy goes there. */
  async function bewege(richtung: Richtung, kopie = false): Promise<void> {
    const platz = nachbarPlatz(kontext.ansicht.tage, mahlzeit.id, einplanung.id, richtung);
    if (!platz) return;
    if (await verschiebe(kontext, einplanung, platz.mahlzeit, platz.position, kopie))
      void fokussiere(einplanung.id);
  }

  async function taste(event: KeyboardEvent): Promise<void> {
    if (!bearbeiten || kontext.busy) return;
    const ziel = event.target as HTMLElement;
    // Typing in the amounts of what it used is no command
    if (ziel.matches('input:not([type="checkbox"]), textarea, select')) return;
    if (event.key === 'Delete') {
      event.preventDefault();
      // The focus goes to the next dish of the meal, else the previous one, else the meal
      const andere = mahlzeit.einplanungen.filter((e) => e.id !== einplanung.id);
      const index = mahlzeit.einplanungen.findIndex((e) => e.id === einplanung.id);
      const naechste = andere[Math.min(index, andere.length - 1)];
      if (await nimmHeraus(kontext, mahlzeit, einplanung)) {
        if (naechste) void fokussiere(naechste.id);
        else {
          await tick();
          document.querySelector<HTMLElement>(`[data-kalender="${mahlzeit.kennung}"]`)?.focus();
        }
      }
      return;
    }
    const richtung = event.altKey ? RICHTUNG[event.key] : undefined;
    if (!richtung) return;
    event.preventDefault();
    event.stopPropagation();
    await bewege(richtung, event.shiftKey);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions (keys of the buttons inside: Delete, Alt+arrows) -->
<div
  bind:this={wurzel}
  data-karte
  data-einplanung={einplanung.id}
  class="rounded-sm border border-l-4 border-neutral-200 {einplanung.status === 'gekocht'
    ? 'border-l-success bg-success-soft'
    : einplanung.status === 'ausgelassen'
      ? 'border-l-neutral-400 bg-neutral-100'
      : 'border-l-brand-800 bg-brand-50'} {bearbeiten ? 'cursor-grab' : ''}"
  draggable={bearbeiten}
  ondragstart={(event) => starte(event, { art: 'einplanung', einplanung, name })}
  ondragend={beende}
  onkeydown={(event) => void taste(event)}
>
  <div class="flex items-start gap-1.5 px-1.5 py-1 {kalender ? 'text-xs' : 'text-sm'}">
    <label
      class="flex shrink-0 items-center justify-center pt-px any-pointer-coarse:size-11"
      title="Gekocht abhaken"
    >
      <input
        type="checkbox"
        class="size-4"
        checked={einplanung.status === 'gekocht'}
        disabled={!bearbeiten || kontext.busy}
        onchange={haken}
      />
      <span class="sr-only">{kennung} {name} gekocht</span>
    </label>
    <div class="min-w-0 flex-1 {kalender ? '' : 'flex flex-wrap items-baseline gap-x-3'}">
      <span class="[overflow-wrap:anywhere]">
        <span
          class="font-mono text-[0.7rem] text-brand-900"
          title="Gericht-ID: Tag_Mahlzeit_Gericht">{kennung}</span
        >
        <button
          type="button"
          data-gericht-name
          class="text-left font-semibold any-pointer-coarse:min-h-11 text-neutral-900 hover:text-link hover:underline {einplanung.status ===
          'ausgelassen'
            ? 'line-through'
            : ''}"
          title="Gericht öffnen"
          aria-label="{kennung} {name} öffnen"
          onclick={() => kontext.oeffneGericht(einplanung.gerichtId)}>{name}</button
        >
      </span>
      <span class="{kalender ? 'block' : ''} text-neutral-700 tabular-nums">
        {zahlText(portionen)} Portionen{faktorText(einplanung.faktor)
          ? ` (${faktorText(einplanung.faktor)})`
          : ''}{einplanung.zustaendig ? ` · ${einplanung.zustaendig}` : ''}
      </span>
      {#if einplanung.status !== 'offen' || fehlt || (gericht && !gericht.zutaten.length)}
        <span class="{kalender ? 'block' : ''} font-semibold">
          {#if einplanung.status === 'gekocht'}<span class="text-success">gekocht</span>
          {:else if einplanung.status === 'ausgelassen'}<span class="text-neutral-700"
              >ausgelassen</span
            >{/if}
          {#if fehlt}<span class="text-warning">Personenzahl fehlt</span>
          {:else if gericht && !gericht.zutaten.length}<span class="font-normal text-neutral-700"
              >noch ohne Zutaten</span
            >{/if}
        </span>
      {/if}
    </div>
    <button
      type="button"
      class="flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-neutral-200 any-pointer-coarse:size-11"
      aria-expanded={offen}
      aria-label="Mehr zu {kennung} {name}"
      title="Mehr"
      onclick={() => (offen = !offen)}
      ><AufklappPfeil class="size-4 transition-transform {offen ? 'rotate-180' : ''}" /></button
    >
  </div>
  <!-- Hidden, not removed, so amounts typed for what it used stay when it is folded -->
  <div
    class="cursor-auto space-y-2 border-t border-neutral-200 bg-surface px-2 py-1.5"
    hidden={!offen}
  >
    {#if bearbeiten}
      <div class="flex flex-wrap gap-1">
        <button
          type="button"
          class={KNOPF}
          disabled={kontext.busy}
          title="Nach oben (Alt+↑)"
          aria-label="{name} bei {kennung} nach oben"
          onclick={() => void bewege('hoch')}>↑</button
        >
        <button
          type="button"
          class={KNOPF}
          disabled={kontext.busy}
          title="Nach unten (Alt+↓)"
          aria-label="{name} bei {kennung} nach unten"
          onclick={() => void bewege('runter')}>↓</button
        >
        <button
          type="button"
          class={KNOPF}
          aria-label="{name} bei {kennung} ändern"
          onclick={() =>
            oneinplanen({ modus: 'aendern', mahlzeitId: mahlzeit.id, einplanungId: einplanung.id })}
          >Ändern …</button
        >
        <button
          type="button"
          class={KNOPF}
          aria-label="{name} bei {kennung} kopieren"
          onclick={() =>
            oneinplanen({
              modus: 'kopieren',
              mahlzeitId: mahlzeit.id,
              einplanungId: einplanung.id,
            })}>Kopieren …</button
        >
        <button
          type="button"
          class={KNOPF}
          disabled={kontext.busy}
          aria-label="{name} bei {kennung}: {einplanung.status === 'offen'
            ? 'Ausgelassen'
            : 'Wieder offen'}"
          onclick={() =>
            void setzeStatus(
              kontext,
              mahlzeit,
              einplanung,
              einplanung.status === 'offen' ? 'ausgelassen' : 'offen',
              esser
            )}>{einplanung.status === 'offen' ? 'Ausgelassen' : 'Wieder offen'}</button
        >
        <button
          type="button"
          class="{KNOPF} text-danger"
          disabled={kontext.busy}
          aria-label="{name} aus {kennung} entfernen"
          onclick={() => void nimmHeraus(kontext, mahlzeit, einplanung)}>Entfernen</button
        >
      </div>
    {/if}
    {#if kalender}
      <button type="button" class={KNOPF} onclick={() => onmengen?.(einplanung.id)}
        >Mengen und Verbrauch</button
      >
    {:else}
      <EinplanungMengen {kontext} {mahlzeit} {einplanung} {name} {esser} {unvertraeglichkeiten} />
      <EinplanungAbhaken
        {kontext}
        {mahlzeit}
        {einplanung}
        {name}
        {esser}
        {bearbeiten}
        onuebernommen={() => (offen = true)}
      />
    {/if}
  </div>
</div>
