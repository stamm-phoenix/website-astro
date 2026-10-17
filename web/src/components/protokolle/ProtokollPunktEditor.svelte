<script lang="ts">
  import { tick } from 'svelte';
  import Self from './ProtokollPunktEditor.svelte';
  import PersonenAuswahl from './PersonenAuswahl.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import {
    MAX_AUFGABEN,
    MAX_TERMINE,
    MAX_TEXT,
    MAX_UNTERPUNKTE,
    MAX_ZUSTAENDIG,
    PROTOKOLL_TEXT_FEATURES,
    aktionZeitraum,
    neuerPunkt,
    newElementId,
    punktNummer,
  } from '../../lib/protokollEditor';
  import { continueList } from '../../lib/protokollMarkdown';
  import type { TextModus } from '../../lib/protokollEditor';
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
    /** Markdown field or formatting editor for the text. */
    textModus?: TextModus;
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
    textModus = 'markdown',
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

  function addAufgabe(): void {
    punkt.aufgaben.push({ id: newElementId(), titel: '', zustaendig: [], faellig: '' });
  }

  async function addTermin(): Promise<void> {
    const id = newElementId();
    punkt.termine.push({ id, titel: '', datum: '', uhrzeit: '', ort: '', zustaendig: [] });
    await tick();
    document.getElementById(`termin-${id}`)?.focus();
  }

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
    placeholder="Was besprochen wurde … (Markdown: - Aufzählung, 1. Liste, **fett**)"
    bind:value={punkt.text}
    {onkeydown}></textarea>
  <details class="hilfe text-sm text-neutral-700">
    <summary class="cursor-pointer">Formatierung</summary>
    <ul class="mt-2 space-y-0.5">
      <li><code>**fett**</code>, <code>*kursiv*</code>, <code>~~durchgestrichen~~</code></li>
      <li><code>- Punkt</code> oder <code>1. Punkt</code>, eingerückt verschachtelt</li>
      <li><code>- [ ] offen</code>, <code>- [x] erledigt</code></li>
      <li><code>[Text](https://…)</code>, Adressen werden von selbst zu Links</li>
      <li>
        <code>## Zwischenüberschrift</code>, <code>&gt; Zitat</code>, <code>---</code> Linie
      </li>
      <li><code>| A | B |</code> mit <code>|---|---|</code> darunter für Tabellen</li>
      <li><code>`Code`</code>, drei <code>```</code> für einen Codeblock</li>
    </ul>
    <p class="mt-1">Enter setzt eine Liste fort, Enter in einem leeren Punkt beendet sie.</p>
  </details>
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
        title="Ziehen zum Verschieben"
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
      {#if textModus === 'formatiert'}
        <!-- The editor is loaded only when it is used; the Markdown field costs nothing -->
        {#await import('../ui/TextEditor.svelte')}
          <div class="skeleton-element h-24 rounded-md" role="status" aria-live="polite">
            <span class="sr-only">Editor wird geladen …</span>
          </div>
        {:then editor}
          <editor.default
            bind:value={punkt.text}
            id="text-{punkt.id}"
            labelledBy="text-label-{punkt.id}"
            placeholder="Was besprochen wurde …"
            features={PROTOKOLL_TEXT_FEATURES}
            maxLength={MAX_TEXT}
          />
        {:catch}
          <p class="text-sm text-danger" role="alert">
            Der Formatierungs-Editor konnte nicht geladen werden, der Text ist unverändert. Lade die
            Seite neu und wähle „Formatiert“ noch einmal, oder schreibe hier in Markdown weiter.
          </p>
          {@render markdownField()}
        {/await}
      {:else}
        {@render markdownField()}
      {/if}

      {#if punkt.aufgaben.length > 0}
        <ul class="space-y-3" aria-label="Aufgaben zu Punkt {nummer}">
          {#each punkt.aufgaben as aufgabe, aufgabeIndex (aufgabe.id)}
            <li class="aufgabe space-y-2 border-l-2 border-accent-500 pl-3">
              <div class="flex items-center gap-2">
                <label for="aufgabe-{aufgabe.id}" class="shrink-0 text-sm font-semibold"
                  >Aufgabe</label
                >
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
                  onclick={() => punkt.aufgaben.splice(aufgabeIndex, 1)}
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
                  <label for="zustaendig-{aufgabe.id}" class="text-sm text-neutral-700"
                    >Zuständig</label
                  >
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

      {#if punkt.termine.length > 0}
        <ul class="space-y-3" aria-label="Termine zu Punkt {nummer}">
          {#each punkt.termine as termin, terminIndex (termin.id)}
            <li class="termin space-y-2 border-l-2 border-brand-400 pl-3">
              <div class="flex items-center gap-2">
                <label for="termin-{termin.id}" class="shrink-0 text-sm font-semibold">Termin</label
                >
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
                  onclick={() => punkt.termine.splice(terminIndex, 1)}
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
                  <label for="termin-datum-{termin.id}" class="text-sm text-neutral-700"
                    >Datum</label
                  >
                  <input
                    id="termin-datum-{termin.id}"
                    type="date"
                    class="form-input py-1"
                    bind:value={termin.datum}
                  />
                </div>
                <div>
                  <label for="termin-uhrzeit-{termin.id}" class="text-sm text-neutral-700"
                    >Uhrzeit</label
                  >
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
        <ActionButton onclick={addAufgabe} disabled={punkt.aufgaben.length >= MAX_AUFGABEN}>
          + Aufgabe
        </ActionButton>
        <ActionButton onclick={addTermin} disabled={punkt.termine.length >= MAX_TERMINE}>
          + Termin
        </ActionButton>
        {#if !isSub}
          <ActionButton
            onclick={addUnterpunkt}
            disabled={punkt.unterpunkte.length >= MAX_UNTERPUNKTE}
          >
            + Unterpunkt
          </ActionButton>
        {/if}
      </div>
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
            {textModus}
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
    padding-left: 5.5rem;
  }
  .is-sub .inhalt {
    padding-left: 5.75rem;
  }
  /* While an item is dragged, every item shrinks to its title row */
  :global(.is-ordering) .details,
  :global(.is-ordering) .ohne-unterpunkte {
    display: none;
  }
  :global(.is-ordering) .punkt-editor {
    row-gap: 0.25rem;
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
    min-height: 4.5rem;
    resize: vertical;
    line-height: 1.55;
    overflow: hidden;
  }
  .hilfe summary {
    width: fit-content;
  }
  .hilfe code {
    font-size: 0.8125rem;
    background: var(--color-neutral-100);
    padding: 0 0.2rem;
    border-radius: var(--radius-sm);
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
