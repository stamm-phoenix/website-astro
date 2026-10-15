<script lang="ts">
  import { tick } from 'svelte';
  import {
    alsHauptpunkt,
    alsUnterpunkt,
    blockLength,
    verschiebe,
    verschiebeSchritt,
    zeilenOf,
    zielEbene,
  } from '../../lib/protokollReihenfolge';
  import type { Verschiebung } from '../../lib/protokollReihenfolge';
  import type { ProtokollPunkt } from '../../lib/types';

  interface Props {
    punkte: ProtokollPunkt[];
  }
  let { punkte = $bindable() }: Props = $props();

  /** Horizontal distance that turns an item into a sub-item or back while dragging. */
  const EBENE_PX = 32;
  /** Distance from the edge of the window where dragging scrolls the page. */
  const SCROLL_EDGE_PX = 72;

  interface Drag {
    from: number;
    length: number;
    pointerId: number;
    startX: number;
    /** Start of the pointer in page coordinates, so scrolling while dragging is counted. */
    startY: number;
    clientY: number;
    dx: number;
    dy: number;
    to: number;
    ebene: 0 | 1 | null;
    moved: boolean;
  }

  const zeilen = $derived(zeilenOf(punkte));
  let list = $state<HTMLOListElement | null>(null);
  let drag = $state<Drag | null>(null);
  /** Top and bottom of every row in page coordinates, measured when dragging starts. */
  let rects: { top: number; bottom: number }[] = [];
  let listTop = 0;
  let scrollFrame = 0;
  /** Bottom of the bars that stay at the top of the window (site header, status bar). */
  let topInset = 0;
  /** Scroll position of the end of the page when dragging starts; the moved rows never extend it. */
  let maxScroll = 0;
  /** How far the dragged rows may move up and down, so they stay within the list. */
  let dyRange = $state.raw({ min: 0, max: 0 });
  let meldung = $state('');
  let meldungFehler = $state(false);

  function titelOf(punkt: ProtokollPunkt): string {
    return punkt.titel.trim() || 'Ohne Titel';
  }

  /** Applies a move; the items keep their content, the editor saves on its own. */
  async function apply(result: Verschiebung | null, punkt: ProtokollPunkt): Promise<void> {
    if (!result) return;
    const titel = titelOf(punkt);
    punkte = result.punkte;
    meldungFehler = false;
    meldung = `„${titel}“ ist jetzt Punkt ${result.nummer}`;
    await tick();
    document.getElementById(`griff-${punkt.id}`)?.focus();
  }

  function snapshot(): ProtokollPunkt[] {
    return $state.snapshot(punkte) as ProtokollPunkt[];
  }

  function step(index: number, delta: -1 | 1): void {
    void apply(verschiebeSchritt(snapshot(), index, delta), zeilen[index].punkt);
  }

  function toggleEbene(index: number): void {
    const zeile = zeilen[index];
    const result =
      zeile.ebene === 0 ? alsUnterpunkt(snapshot(), index) : alsHauptpunkt(snapshot(), index);
    void apply(result, zeile.punkt);
  }

  /** Arrow keys on the handle: up and down move, right and left change the level. */
  function onkeydown(event: KeyboardEvent, index: number): void {
    if (drag) {
      if (event.key === 'Escape') cancel();
      return;
    }
    const zeile = zeilen[index];
    if (event.key === 'ArrowUp') step(index, -1);
    else if (event.key === 'ArrowDown') step(index, 1);
    else if (event.key === 'ArrowRight' && zeile.ebene === 0) toggleEbene(index);
    else if (event.key === 'ArrowLeft' && zeile.ebene === 1) toggleEbene(index);
    else return;
    event.preventDefault();
  }

  // --- Dragging ---

  function onpointerdown(event: PointerEvent, index: number): void {
    if (event.button !== 0 || !list || drag) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const rows = [...list.querySelectorAll<HTMLElement>(':scope > li')];
    rects = rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY };
    });
    listTop = list.getBoundingClientRect().top + window.scrollY;
    const listBottom = list.getBoundingClientRect().bottom + window.scrollY;
    const length = blockLength(zeilen, index);
    dyRange = {
      min: listTop - rects[index].top,
      max: listBottom - rects[index + length - 1].bottom,
    };
    maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    topInset = Math.max(
      0,
      ...[...document.querySelectorAll<HTMLElement>('body > header, [data-sticky-top]')].map(
        (element) => element.getBoundingClientRect().bottom
      )
    );
    drag = {
      from: index,
      length,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY + window.scrollY,
      clientY: event.clientY,
      dx: 0,
      dy: 0,
      to: index,
      ebene: zeilen[index].ebene,
      moved: false,
    };
    meldung = '';
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function onpointermove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.dx = event.clientX - drag.startX;
    drag.clientY = event.clientY;
    update();
  }

  /** Where the dragged rows would go: before the first remaining row below the pointer. */
  function update(): void {
    if (!drag) return;
    const pageY = drag.clientY + window.scrollY;
    drag.dy = pageY - drag.startY;
    if (Math.abs(drag.dx) > 4 || Math.abs(drag.dy) > 4) drag.moved = true;
    let to = 0;
    rects.forEach((rect, index) => {
      if (index >= drag!.from && index < drag!.from + drag!.length) return;
      if ((rect.top + rect.bottom) / 2 < pageY) to++;
    });
    const eigene = zeilen[drag.from].ebene;
    const wunsch = drag.dx > EBENE_PX ? 1 : drag.dx < -EBENE_PX ? 0 : eigene;
    const ebene = zielEbene(zeilen, drag.from, to, wunsch);
    drag.to = to;
    drag.ebene =
      ebene !== null && verschiebe(snapshot(), drag.from, to, ebene) !== null ? ebene : null;
  }

  function autoScroll(): void {
    if (!drag) return;
    const { clientY } = drag;
    let delta = 0;
    const top = topInset + SCROLL_EDGE_PX;
    if (clientY < top) delta = -Math.ceil((top - clientY) / 6);
    else if (clientY > window.innerHeight - SCROLL_EDGE_PX)
      delta = Math.ceil((clientY - window.innerHeight + SCROLL_EDGE_PX) / 6);
    // Stop at the top and at the end of the page as it was when dragging started
    delta = Math.max(-window.scrollY, Math.min(delta, maxScroll - window.scrollY));
    if (delta !== 0) {
      window.scrollBy({ top: delta, behavior: 'instant' });
      update();
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function onpointerup(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { from, to, ebene, moved } = drag;
    const punkt = zeilen[from].punkt;
    end();
    if (!moved) return;
    if (ebene === null) {
      meldungFehler = true;
      meldung =
        'Dort passt der Punkt nicht hin. Ein Punkt mit Unterpunkten bleibt ein Hauptpunkt, zwischen Unterpunkten ist nur ein Unterpunkt möglich.';
      return;
    }
    void apply(verschiebe(snapshot(), from, to, ebene), punkt);
  }

  function cancel(): void {
    end();
    meldungFehler = false;
    meldung = 'Verschieben abgebrochen.';
  }

  function end(): void {
    cancelAnimationFrame(scrollFrame);
    drag = null;
  }

  // Closing the list while dragging must not leave the page scrolling
  $effect(() => end);

  /** Position and label of the line where the dragged rows would land. */
  const ziel = $derived.by(() => {
    if (!drag || !drag.moved) return null;
    const rest = zeilen
      .map((zeile, index) => ({ zeile, index }))
      .filter(({ index }) => index < drag!.from || index >= drag!.from + drag!.length);
    const next = rest[drag.to];
    const before = rest[drag.to - 1];
    const y = next
      ? rects[next.index].top - listTop
      : before
        ? rects[before.index].bottom - listTop
        : 0;
    if (drag.ebene === null) return { y, ebene: 0, text: 'Hier nicht möglich', fehler: true };
    if (drag.ebene === 0) return { y, ebene: 0, text: 'als Hauptpunkt', fehler: false };
    const parent = rest
      .slice(0, drag.to)
      .reverse()
      .find(({ zeile }) => zeile.ebene === 0);
    return {
      y,
      ebene: 1,
      text: parent
        ? `als Unterpunkt von ${parent.zeile.nummer} ${titelOf(parent.zeile.punkt)}`
        : 'als Unterpunkt',
      fehler: false,
    };
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (drag && event.key === 'Escape') cancel();
  }}
/>

<div class="space-y-3">
  <p class="max-w-prose text-sm text-neutral-700">
    Halte einen Punkt am Griff
    <svg
      aria-hidden="true"
      class="inline h-4 w-4 align-[-2px]"
      viewBox="0 0 24 24"
      fill="currentColor"
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
    fest und ziehe ihn an eine neue Stelle. Nach rechts gezogen wird er Unterpunkt des Punkts darüber,
    nach links wieder Hauptpunkt. Unterpunkte wandern mit ihrem Hauptpunkt mit. Änderungen werden sofort
    gespeichert.
  </p>

  <div class="relative">
    <ol
      bind:this={list}
      class:is-dragging={drag !== null}
      class="reihenfolge divide-y divide-neutral-200 border-y border-neutral-200"
      aria-label="Reihenfolge der Tagesordnung"
    >
      {#each zeilen as zeile, index (zeile.punkt.id)}
        {@const dragged = drag !== null && index >= drag.from && index < drag.from + drag.length}
        <li
          class="zeile flex items-center gap-1 py-1"
          class:is-sub={zeile.ebene === 1}
          class:is-dragged={dragged && drag?.moved}
          style:transform={dragged && drag?.moved
            ? `translate(${Math.max(-48, Math.min(48, drag.dx))}px, ${Math.max(
                dyRange.min,
                Math.min(dyRange.max, drag.dy)
              )}px)`
            : undefined}
        >
          <button
            type="button"
            id="griff-{zeile.punkt.id}"
            class="griff icon-button"
            aria-label="{zeile.nummer} {titelOf(
              zeile.punkt
            )} verschieben. Pfeiltasten hoch und runter verschieben, rechts macht ihn zum Unterpunkt, links zum Hauptpunkt."
            onpointerdown={(event) => onpointerdown(event, index)}
            {onpointermove}
            {onpointerup}
            onpointercancel={() => drag && cancel()}
            onkeydown={(event) => onkeydown(event, index)}
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
          <span class="nummer shrink-0 font-semibold tabular-nums text-brand-900"
            >{zeile.nummer}</span
          >
          <span
            class="min-w-0 flex-1 break-words"
            class:font-semibold={zeile.ebene === 0}
            class:text-neutral-700={!zeile.punkt.titel.trim()}>{titelOf(zeile.punkt)}</span
          >
          <span class="flex shrink-0" role="group" aria-label="Punkt {zeile.nummer} verschieben">
            <button
              type="button"
              class="icon-button"
              aria-label="Punkt {zeile.nummer} nach oben"
              disabled={verschiebeSchritt(punkte, index, -1) === null}
              onclick={() => step(index, -1)}
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
              aria-label="Punkt {zeile.nummer} nach unten"
              disabled={verschiebeSchritt(punkte, index, 1) === null}
              onclick={() => step(index, 1)}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><path d="M12 5v14M19 12l-7 7-7-7" /></svg
              >
            </button>
            {#if zeile.ebene === 0}
              <button
                type="button"
                class="icon-button"
                aria-label="Punkt {zeile.nummer} zum Unterpunkt des Punkts darüber machen"
                title="Zum Unterpunkt machen"
                disabled={alsUnterpunkt(punkte, index) === null}
                onclick={() => toggleEbene(index)}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"><path d="M5 5v8h14M15 9l4 4-4 4" /></svg
                >
              </button>
            {:else}
              <button
                type="button"
                class="icon-button"
                aria-label="Punkt {zeile.nummer} zum Hauptpunkt machen"
                title="Zum Hauptpunkt machen"
                disabled={alsHauptpunkt(punkte, index) === null}
                onclick={() => toggleEbene(index)}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"><path d="M19 5v8H5M9 9l-4 4 4 4" /></svg
                >
              </button>
            {/if}
          </span>
        </li>
      {/each}
    </ol>
    {#if ziel}
      <div
        class="ziel"
        class:is-sub={ziel.ebene === 1}
        class:is-fehler={ziel.fehler}
        style:top="{ziel.y}px"
        aria-hidden="true"
      >
        <span>{ziel.text}</span>
      </div>
    {/if}
  </div>

  <p
    class="min-h-5 text-sm"
    class:text-success={!meldungFehler && meldung}
    class:text-danger={meldungFehler}
    role="status"
    aria-live="polite"
  >
    {meldung}
  </p>
</div>

<style>
  .is-dragging {
    user-select: none;
    -webkit-user-select: none;
  }
  .zeile {
    position: relative;
    background: var(--color-neutral-50);
  }
  .zeile.is-sub {
    padding-left: 2.25rem;
  }
  .zeile.is-dragged {
    z-index: 2;
    opacity: 0.85;
    box-shadow: 0 0.25rem 0.75rem rgb(0 0 0 / 0.18);
  }
  .nummer {
    min-width: 2.25rem;
  }
  .griff {
    cursor: grab;
    touch-action: none;
  }
  .is-dragged .griff {
    cursor: grabbing;
  }
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
  .icon-button:disabled {
    opacity: 0.35;
  }
  .icon-button svg {
    width: 1.1rem;
    height: 1.1rem;
  }
  .ziel {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 3;
    border-top: 3px solid var(--color-action);
    pointer-events: none;
    transform: translateY(-1.5px);
  }
  .ziel.is-sub {
    left: 2.25rem;
  }
  .ziel.is-fehler {
    border-top-style: dashed;
    border-color: var(--color-danger);
  }
  .ziel span {
    position: absolute;
    right: 0;
    top: 0.25rem;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: var(--radius-sm);
    background: var(--color-action);
    color: var(--color-on-action);
    padding: 0.1rem 0.4rem;
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .ziel.is-fehler span {
    background: var(--color-danger);
    color: var(--color-neutral-50);
  }
</style>
