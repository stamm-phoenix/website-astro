<script lang="ts">
  import Self from './ProtokollPunktEditor.svelte';
  import ProtokollPunktExtras from './ProtokollPunktExtras.svelte';
  import {
    MAX_TEXT,
    aktionZeitraum,
    neuerPunkt,
    newElementId,
    punktNummer,
  } from '../../lib/protokollEditor';
  import { continueList } from '../../lib/protokollMarkdown';
  import type { Griff } from '../../lib/protokollReihenfolge';
  import type { PersonOption, ProtokollPunkt } from '../../lib/types';

  interface Props {
    punkt: ProtokollPunkt;
    index: number;
    /** Position below the parent; `null` for a top-level item. */
    subIndex?: number | null;
    count: number;
    personen: PersonOption[];
    onmove: (delta: -1 | 1) => void;
    onremove: () => void;
    /** Asks before an item with content goes; calls `remove` once confirmed. */
    confirmRemove: (punkt: ProtokollPunkt, nummer: string, remove: () => void) => void;
    /** The handle to drag the item to another place (`ProtokollTagesordnung`). */
    griff?: Griff;
  }
  let {
    punkt = $bindable(),
    index,
    subIndex = null,
    count,
    personen,
    onmove,
    onremove,
    confirmRemove,
    griff,
  }: Props = $props();

  const position = $derived(subIndex ?? index);
  const nummer = $derived(punktNummer(index, subIndex ?? undefined));
  const isSub = $derived(subIndex !== null);
  const label = $derived(`${nummer} ${punkt.titel.trim() || 'Tagesordnungspunkt'}`);
  const zeitraum = $derived(punkt.aktion ? aktionZeitraum(punkt.aktion) : '');

  let textarea = $state<HTMLTextAreaElement | null>(null);

  /** Grows the text field with its content, so the whole item stays readable on screen. */
  function grow(element: HTMLTextAreaElement): void {
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight + 2}px`;
  }

  $effect(() => {
    void punkt.text;
    if (textarea) grow(textarea);
  });

  function addUnterpunkt(): void {
    punkt.unterpunkte.push(neuerPunkt(newElementId()));
  }

  function moveSub(at: number, delta: -1 | 1): void {
    const target = at + delta;
    if (target < 0 || target >= punkt.unterpunkte.length) return;
    const [item] = punkt.unterpunkte.splice(at, 1);
    punkt.unterpunkte.splice(target, 0, item);
  }

  /**
   * Pressing Enter on a list line continues the list, as in a word processor: bullets, numbers
   * (counting up) and checkboxes. Enter on an empty item ends the list.
   */
  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart !== selectionEnd) return;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const lineEnd = value.indexOf('\n', selectionStart);
    // Only at the end of the line; in the middle Enter splits it as usual
    if (value.slice(selectionStart, lineEnd === -1 ? value.length : lineEnd).trim()) return;
    const list = continueList(value.slice(lineStart, selectionStart));
    if (!list) return;
    event.preventDefault();
    if (list.end) {
      punkt.text = value.slice(0, lineStart) + value.slice(selectionStart);
      requestAnimationFrame(() => textarea?.setSelectionRange(lineStart, lineStart));
      return;
    }
    punkt.text = `${value.slice(0, selectionStart)}\n${list.next}${value.slice(selectionEnd)}`;
    const caret = selectionStart + 1 + list.next.length;
    requestAnimationFrame(() => textarea?.setSelectionRange(caret, caret));
  }
</script>

{#snippet markdownField()}
  <textarea
    id="text-{punkt.id}"
    bind:this={textarea}
    class="form-input text"
    rows="2"
    maxlength={MAX_TEXT}
    placeholder="Was besprochen wurde …"
    bind:value={punkt.text}
    {onkeydown}></textarea>
{/snippet}

<section
  class="punkt-editor space-y-3"
  class:is-sub={isSub}
  data-punkt={punkt.id}
  aria-label={label}
>
  <div class="kopf flex items-start gap-1" data-punkt-kopf={punkt.id}>
    {#if griff}
      <button
        type="button"
        id="griff-{punkt.id}"
        class="griff icon-button"
        aria-label="{label} verschieben. Ziehen oder Pfeiltasten: hoch und runter verschieben, rechts macht ihn zum Unterpunkt, links zum Hauptpunkt."
        onpointerdown={(event) => griff.down(event, punkt.id)}
        onkeydown={(event) => griff.key(event, punkt.id)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"
          ><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle
            cx="9"
            cy="12"
            r="1.6"
          /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle
            cx="15"
            cy="18"
            r="1.6"
          /></svg
        >
      </button>
    {/if}
    <span class="nummer pt-2 font-semibold tabular-nums text-brand-900" aria-hidden="true">
      {nummer}
    </span>
    <div class="min-w-0 flex-1">
      <label for="titel-{punkt.id}" class="sr-only">Titel von Punkt {nummer}</label>
      <input
        id="titel-{punkt.id}"
        type="text"
        class="form-input titel font-semibold"
        maxlength="200"
        placeholder="Titel des Tagesordnungspunkts"
        bind:value={punkt.titel}
      />
      {#if punkt.aktion}
        <p class="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-neutral-700">
          <span>Aktion{zeitraum ? `, ${zeitraum}` : ''}</span>
          <button
            type="button"
            class="text-link text-sm"
            onclick={() => (punkt.aktion = null)}
            aria-label="Verknüpfung mit der Aktion {punkt.aktion.titel} lösen"
            >Verknüpfung lösen</button
          >
        </p>
      {/if}
    </div>
    <div
      class="flex shrink-0 gap-1"
      role="group"
      aria-label="Punkt {nummer} verschieben oder löschen"
    >
      <button
        type="button"
        class="icon-button"
        aria-label="Punkt {nummer} nach oben"
        disabled={position === 0}
        onclick={() => onmove(-1)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7" /></svg
        >
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label="Punkt {nummer} nach unten"
        disabled={position === count - 1}
        onclick={() => onmove(1)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"><path d="M12 5v14M19 12l-7 7-7-7" /></svg
        >
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label="Punkt {nummer} löschen"
        onclick={onremove}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg
        >
      </button>
    </div>
  </div>

  <div class="inhalt space-y-3" class:ohne-unterpunkte={punkt.unterpunkte.length === 0}>
    <div class="details space-y-3">
      <label for="text-{punkt.id}" id="text-label-{punkt.id}" class="sr-only"
        >Text zu Punkt {nummer}</label
      >
      {@render markdownField()}

      <ProtokollPunktExtras
        bind:aufgaben={punkt.aufgaben}
        bind:termine={punkt.termine}
        bind:projekt={punkt.projekt}
        bind:offeneAufgaben={punkt.offeneAufgaben}
        aktion={punkt.aktion}
        {nummer}
        {personen}
        {isSub}
        unterpunkte={punkt.unterpunkte.length}
        onAddUnterpunkt={addUnterpunkt}
      />
    </div>

    {#if punkt.unterpunkte.length > 0}
      <div class="space-y-5 border-l border-neutral-200 pl-4">
        {#each punkt.unterpunkte as sub, at (sub.id)}
          <Self
            bind:punkt={punkt.unterpunkte[at]}
            {index}
            subIndex={at}
            count={punkt.unterpunkte.length}
            {personen}
            onmove={(delta) => moveSub(at, delta)}
            onremove={() =>
              confirmRemove(punkt.unterpunkte[at], punktNummer(index, at), () =>
                punkt.unterpunkte.splice(at, 1)
              )}
            {confirmRemove}
            {griff}
          />
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .nummer {
    min-width: 2.25rem;
  }
  .is-sub .nummer {
    min-width: 2.5rem;
  }
  .inhalt {
    padding-left: calc(var(--spacing) * 22);
  }
  .is-sub .inhalt {
    padding-left: calc(var(--spacing) * 23);
  }
  /* While an item is dragged, every item shrinks to its title row */
  :global(.is-ordering) .details,
  :global(.is-ordering) .ohne-unterpunkte {
    display: none;
  }
  :global(.is-ordering) .punkt-editor {
    row-gap: var(--spacing);
  }
  .icon-button.griff {
    width: 2.75rem;
    height: 2.75rem;
    cursor: grab;
    touch-action: none;
  }
  @media (max-width: 40rem) {
    .inhalt,
    .is-sub .inhalt {
      padding-left: 0;
    }
  }
  .titel {
    font-size: 1.0625rem;
  }
  .text {
    min-height: calc(var(--spacing) * 18);
    resize: vertical;
    line-height: 1.55;
    overflow: hidden;
  }
  .icon-button {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius-md);
    color: var(--color-neutral-700);
  }
  .icon-button:hover:not(:disabled) {
    background: var(--color-neutral-100);
  }
  .icon-button:disabled {
    opacity: 0.35;
  }
  .icon-button svg {
    width: 1.1rem;
    height: 1.1rem;
  }
</style>
