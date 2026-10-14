<script lang="ts">
  import Self from './ProtokollPunktEditor.svelte';
  import PersonenAuswahl from './PersonenAuswahl.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import {
    MAX_AUFGABEN,
    MAX_TEXT,
    MAX_UNTERPUNKTE,
    aktionZeitraum,
    neuerPunkt,
    newElementId,
    punktNummer,
  } from '../../lib/protokollEditor';
  import type { ProtokollPerson, ProtokollPunkt } from '../../lib/types';

  interface Props {
    punkt: ProtokollPunkt;
    index: number;
    /** Position below the parent; `null` for a top-level item. */
    subIndex?: number | null;
    count: number;
    personen: ProtokollPerson[];
    onmove: (delta: -1 | 1) => void;
    onremove: () => void;
    /** Asks before an item with content goes; calls `remove` once confirmed. */
    confirmRemove: (punkt: ProtokollPunkt, nummer: string, remove: () => void) => void;
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

  function addUnterpunkt(): void {
    punkt.unterpunkte.push(neuerPunkt(newElementId()));
  }

  function moveSub(at: number, delta: -1 | 1): void {
    const target = at + delta;
    if (target < 0 || target >= punkt.unterpunkte.length) return;
    const [item] = punkt.unterpunkte.splice(at, 1);
    punkt.unterpunkte.splice(target, 0, item);
  }

  /** Pressing Enter on a list line continues the list, as in a word processor. */
  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || !textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart !== selectionEnd) return;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const line = value.slice(lineStart, selectionStart);
    const bullet = /^(\s*[-*•]\s+)/.exec(line)?.[1];
    if (!bullet) return;
    event.preventDefault();
    if (line.trim() === bullet.trim()) {
      // An empty list line ends the list
      punkt.text = value.slice(0, lineStart) + value.slice(selectionStart);
      requestAnimationFrame(() => textarea?.setSelectionRange(lineStart, lineStart));
      return;
    }
    punkt.text = `${value.slice(0, selectionStart)}\n${bullet}${value.slice(selectionEnd)}`;
    const caret = selectionStart + 1 + bullet.length;
    requestAnimationFrame(() => textarea?.setSelectionRange(caret, caret));
  }
</script>

<section
  class="punkt-editor space-y-3"
  class:is-sub={isSub}
  data-punkt={punkt.id}
  aria-label={label}
>
  <div class="flex items-start gap-2">
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

  <div class="inhalt space-y-3">
    <label for="text-{punkt.id}" class="sr-only">Text zu Punkt {nummer}</label>
    <textarea
      id="text-{punkt.id}"
      bind:this={textarea}
      class="form-input text"
      rows="2"
      maxlength={MAX_TEXT}
      placeholder="Was besprochen wurde … (- für Aufzählungen, **fett**)"
      bind:value={punkt.text}
      {onkeydown}></textarea>

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

    <div class="flex flex-wrap gap-2">
      <ActionButton onclick={addAufgabe} disabled={punkt.aufgaben.length >= MAX_AUFGABEN}>
        + Aufgabe
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
    padding-left: 2.75rem;
  }
  .is-sub .inhalt {
    padding-left: 3rem;
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
