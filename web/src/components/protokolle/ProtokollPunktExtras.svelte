<script lang="ts">
  import { tick } from 'svelte';
  import PersonenAuswahl from './PersonenAuswahl.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import {
    MAX_AUFGABEN,
    MAX_TERMINE,
    MAX_UNTERPUNKTE,
    MAX_ZUSTAENDIG,
    newElementId,
  } from '../../lib/protokollEditor';
  import type { PersonOption, ProtokollAufgabe, PunktTermin } from '../../lib/types';

  /**
   * The tasks and dates of an agenda item with the buttons to add them (and a sub-item). Shown
   * below the text, in the Markdown fields (`ProtokollPunktEditor`) as well as in the document
   * (`ProtokollDokument`).
   */
  interface Props {
    aufgaben: ProtokollAufgabe[];
    termine: PunktTermin[];
    /** „1.“, „1a.“ */
    nummer: string;
    personen: PersonOption[];
    /** Sub-items have no sub-items of their own, so no button for one. */
    isSub?: boolean;
    /** How many sub-items the item has; the button stops at the limit. */
    unterpunkte?: number;
    onAddUnterpunkt?: () => void;
  }
  let {
    aufgaben = $bindable(),
    termine = $bindable(),
    nummer,
    personen,
    isSub = false,
    unterpunkte = 0,
    onAddUnterpunkt,
  }: Props = $props();

  function addAufgabe(): void {
    aufgaben.push({ id: newElementId(), titel: '', zustaendig: [], faellig: '' });
  }

  async function addTermin(): Promise<void> {
    const id = newElementId();
    termine.push({ id, titel: '', datum: '', uhrzeit: '', ort: '', zustaendig: [] });
    await tick();
    document.getElementById(`termin-${id}`)?.focus();
  }
</script>

{#if aufgaben.length > 0}
  <ul class="space-y-3" aria-label="Aufgaben zu Punkt {nummer}">
    {#each aufgaben as aufgabe, aufgabeIndex (aufgabe.id)}
      <li class="aufgabe space-y-2 border-l-2 border-accent-500 pl-3">
        <div class="flex items-center gap-2">
          <label for="aufgabe-{aufgabe.id}" class="shrink-0 text-sm font-semibold">Aufgabe</label>
          <input
            id="aufgabe-{aufgabe.id}"
            type="text"
            class="form-input"
            maxlength="500"
            placeholder="Was ist zu tun?"
            bind:value={aufgabe.titel}
          />
          <button
            type="button"
            class="icon-button"
            aria-label="Aufgabe {aufgabe.titel || aufgabeIndex + 1} entfernen"
            onclick={() => aufgaben.splice(aufgabeIndex, 1)}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"><path d="M6 6l12 12M18 6L6 18" /></svg
            >
          </button>
        </div>
        <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div>
            <label for="zustaendig-{aufgabe.id}" class="text-sm text-neutral-700">Zuständig</label>
            <PersonenAuswahl
              id="zustaendig-{aufgabe.id}"
              bind:selected={aufgabe.zustaendig}
              {personen}
              max={MAX_ZUSTAENDIG}
              listLabel="Zuständig für die Aufgabe {aufgabe.titel || aufgabeIndex + 1}"
            />
          </div>
          <div>
            <label for="faellig-{aufgabe.id}" class="text-sm text-neutral-700">Fällig</label>
            <input
              id="faellig-{aufgabe.id}"
              type="date"
              class="form-input py-1"
              bind:value={aufgabe.faellig}
            />
          </div>
        </div>
      </li>
    {/each}
  </ul>
{/if}

{#if termine.length > 0}
  <ul class="space-y-3" aria-label="Termine zu Punkt {nummer}">
    {#each termine as termin, terminIndex (termin.id)}
      <li class="termin space-y-2 border-l-2 border-brand-400 pl-3">
        <div class="flex items-center gap-2">
          <label for="termin-{termin.id}" class="shrink-0 text-sm font-semibold">Termin</label>
          <input
            id="termin-{termin.id}"
            type="text"
            class="form-input"
            maxlength="500"
            placeholder="Was findet statt?"
            bind:value={termin.titel}
          />
          <button
            type="button"
            class="icon-button"
            aria-label="Termin {termin.titel || terminIndex + 1} entfernen"
            onclick={() => termine.splice(terminIndex, 1)}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"><path d="M6 6l12 12M18 6L6 18" /></svg
            >
          </button>
        </div>
        <div class="grid gap-2 sm:grid-cols-[auto_auto_1fr]">
          <div>
            <label for="termin-datum-{termin.id}" class="text-sm text-neutral-700">Datum</label>
            <input
              id="termin-datum-{termin.id}"
              type="date"
              class="form-input py-1"
              bind:value={termin.datum}
            />
          </div>
          <div>
            <label for="termin-uhrzeit-{termin.id}" class="text-sm text-neutral-700">Uhrzeit</label>
            <input
              id="termin-uhrzeit-{termin.id}"
              type="time"
              class="form-input py-1"
              bind:value={termin.uhrzeit}
            />
          </div>
          <div>
            <label for="termin-ort-{termin.id}" class="text-sm text-neutral-700">Ort</label>
            <input
              id="termin-ort-{termin.id}"
              type="text"
              class="form-input py-1"
              maxlength="200"
              bind:value={termin.ort}
            />
          </div>
        </div>
        <div>
          <label for="termin-zustaendig-{termin.id}" class="text-sm text-neutral-700"
            >Zuständig</label
          >
          <PersonenAuswahl
            id="termin-zustaendig-{termin.id}"
            bind:selected={termin.zustaendig}
            {personen}
            max={MAX_ZUSTAENDIG}
            listLabel="Zuständig für den Termin {termin.titel || terminIndex + 1}"
          />
        </div>
      </li>
    {/each}
  </ul>
{/if}

<div class="flex flex-wrap gap-2">
  <ActionButton onclick={addAufgabe} disabled={aufgaben.length >= MAX_AUFGABEN}>
    + Aufgabe
  </ActionButton>
  <ActionButton onclick={addTermin} disabled={termine.length >= MAX_TERMINE}>+ Termin</ActionButton>
  {#if !isSub && onAddUnterpunkt}
    <ActionButton onclick={onAddUnterpunkt} disabled={unterpunkte >= MAX_UNTERPUNKTE}>
      + Unterpunkt
    </ActionButton>
  {/if}
</div>

<style>
  .icon-button {
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--radius-md);
    color: var(--color-neutral-700);
  }
  .icon-button:hover:not(:disabled) {
    background: var(--color-neutral-100);
  }
  .icon-button svg {
    width: 1.1rem;
    height: 1.1rem;
  }
</style>
