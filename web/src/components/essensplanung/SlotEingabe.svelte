<script lang="ts">
  import { tick } from 'svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import type { PlanungMahlzeit } from '../../lib/types';
  import { tippeEin } from './planAktionen';
  import type { PlanKontext } from './planKontext';

  /**
   * Typing a dish into a meal: a name of an existing dish plans it there, a new name creates the
   * dish there; optionally who is responsible. Enter adds it and keeps the field open for the
   * next, Escape closes it.
   */

  interface Props {
    kontext: PlanKontext;
    mahlzeit: PlanungMahlzeit;
    /** Classes of the closed button, e.g. faint until the cell is hovered. */
    knopfKlasse?: string;
    /** After closing, e.g. to put the focus back on the cell of the calendar. */
    onschliessen?: () => void;
  }
  let { kontext, mahlzeit, knopfKlasse = '', onschliessen }: Props = $props();

  let offen = $state(false);
  let name = $state('');
  let zustaendig = $state('');
  let feld = $state<HTMLInputElement | null>(null);
  let form = $state<HTMLFormElement | null>(null);
  $effect(() => guardUnsavedChanges(() => name.trim() !== ''));

  const gerichte = $derived(
    kontext.ansicht.gerichte.map((g) => ({ value: g.name, key: String(g.id) }))
  );
  const mitglieder = $derived(
    kontext.ansicht.mitglieder.filter((m) => !m.entzogen).map((m) => ({ value: m.name }))
  );

  /** Opens the fields, with the first typed letter if the cell got it. */
  export async function oeffne(text = ''): Promise<void> {
    offen = true;
    if (text) name = text;
    await tick();
    feld?.focus();
  }

  function schliessen(): void {
    offen = false;
    name = '';
    zustaendig = '';
    onschliessen?.();
  }

  async function eintragen(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const gesendet = name;
    if (!gesendet.trim() || kontext.busy) return;
    if (await tippeEin(kontext, mahlzeit, gesendet, zustaendig)) {
      // What was typed meanwhile stays; the next dish goes in the same field
      if (name === gesendet) name = '';
      await tick();
      feld?.focus();
    }
  }

  /** Leaving the fields empty closes them; typed input stays open. */
  function verlassen(event: FocusEvent): void {
    const nach = event.relatedTarget as Node | null;
    if (nach && form?.contains(nach)) return;
    if (!name.trim() && !zustaendig.trim()) {
      offen = false;
      zustaendig = '';
    }
  }
</script>

{#if offen}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape closes both fields) -->
  <form
    bind:this={form}
    class="space-y-1"
    onsubmit={(event) => void eintragen(event)}
    onfocusout={verlassen}
    onkeydown={(event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      schliessen();
    }}
  >
    <VorschlagFeld
      id="slot-{mahlzeit.id}-gericht"
      class="form-input mt-0 min-h-0 px-2 py-1 text-sm any-pointer-coarse:min-h-11"
      options={gerichte}
      listLabel="Gerichte der Planung"
      maxlength={150}
      placeholder="Gericht"
      aria-label="Gericht bei {mahlzeit.kennung} {mahlzeit.name}"
      bind:value={name}
      bind:input={feld}
    />
    <VorschlagFeld
      id="slot-{mahlzeit.id}-zustaendig"
      class="form-input mt-0 min-h-0 px-2 py-1 text-xs any-pointer-coarse:min-h-11"
      options={mitglieder}
      listLabel="Mitglieder"
      maxlength={100}
      placeholder="Zuständig (optional)"
      aria-label="Zuständig für das Gericht bei {mahlzeit.kennung}"
      bind:value={zustaendig}
    />
    <!-- Enter in either field adds; a visible button for touch -->
    <div class="flex gap-1">
      <button
        type="submit"
        class="btn-primary min-h-0 px-2 py-0.5 text-xs any-pointer-coarse:min-h-11"
        disabled={!name.trim() || kontext.busy}>Eintragen</button
      >
      <button
        type="button"
        class="min-h-0 px-2 py-0.5 text-xs text-neutral-700 hover:underline any-pointer-coarse:min-h-11"
        onclick={schliessen}>Abbrechen</button
      >
    </div>
  </form>
{:else}
  <button
    type="button"
    class="flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 hover:text-brand-900 any-pointer-coarse:min-h-11 {knopfKlasse}"
    aria-label="Gericht eintragen bei {mahlzeit.kennung} {mahlzeit.name}"
    onclick={() => void oeffne()}><span aria-hidden="true">+</span> Gericht</button
  >
{/if}
