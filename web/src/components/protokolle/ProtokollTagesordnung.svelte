<script lang="ts">
  import { tick } from 'svelte';
  import ProtokollPunktEditor from './ProtokollPunktEditor.svelte';
  import {
    alsHauptpunkt,
    alsUnterpunkt,
    blockLength,
    verschiebe,
    verschiebeSchritt,
    zeilenOf,
    zielEbene,
  } from '../../lib/protokollReihenfolge';
  import type { Griff, Verschiebung } from '../../lib/protokollReihenfolge';
  import { MAX_PUNKTE, MAX_UNTERPUNKTE } from '../../lib/protokollEditor';
  import type { TextModus } from '../../lib/protokollEditor';
  import type { PersonOption, ProtokollPunkt } from '../../lib/types';

  interface Props {
    punkte: ProtokollPunkt[];
    personen: PersonOption[];
    /** Asks before an item with content goes; calls `remove` once confirmed. */
    confirmRemove: (punkt: ProtokollPunkt, nummer: string, remove: () => void) => void;
    /** Markdown fields per item (`ProtokollPunktEditor`) or the agenda as one document. */
    textModus?: TextModus;
    /** The item written at the cursor of the document, for readers following along. */
    onactive?: (id: string | null) => void;
  }
  let {
    punkte = $bindable(),
    personen,
    confirmRemove,
    textModus = 'markdown',
    onactive,
  }: Props = $props();

  /** Distance the pointer moves before dragging starts, so a click on the handle does nothing. */
  const START_PX = 6;
  /** Horizontal distance that turns an item into a sub-item or back while dragging. */
  const EBENE_PX = 32;
  /** Distance from the edge of the window where dragging scrolls the page. */
  const SCROLL_EDGE_PX = 72;

  interface Pending {
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    /** Where the handle was grabbed, relative to the title row of the item. */
    offsetY: number;
  }

  interface Drag {
    /** The order of the rows when dragging started; checked again on drop. */
    order: string;
    from: number;
    length: number;
    pointerId: number;
    startX: number;
    /** Pointer position in page coordinates when dragging started. */
    startY: number;
    clientX: number;
    clientY: number;
    to: number;
    ebene: 0 | 1 | null;
  }

  const zeilen = $derived(zeilenOf(punkte));
  let container = $state<HTMLDivElement | null>(null);
  /** While dragging, every item shrinks to its title row. */
  let ordering = $state(false);
  let pending: Pending | null = null;
  let drag = $state<Drag | null>(null);
  /** The item being dragged, moved with the pointer. */
  let dragged: HTMLElement | null = null;
  /** Top and bottom of every title row in page coordinates, measured when dragging starts. */
  let rects: { top: number; bottom: number }[] = [];
  let containerTop = 0;
  let scrollFrame = 0;
  /** Bottom of the bars that stay at the top of the window (site header, status bar). */
  let topInset = 0;
  /** Height of the bars fixed to the bottom of the window. */
  let bottomInset = 0;
  /** End of the page when dragging starts; the moved item never extends it. */
  let maxScroll = 0;
  /** How far the dragged item may move up and down, so it stays within the agenda. */
  let dyRange = { min: 0, max: 0 };
  let meldung = $state('');
  let meldungFehler = $state(false);

  function titelOf(punkt: ProtokollPunkt): string {
    return punkt.titel.trim() || 'Ohne Titel';
  }

  function snapshot(): ProtokollPunkt[] {
    return $state.snapshot(punkte) as ProtokollPunkt[];
  }

  /** The agenda as ids with their level, to notice a change while dragging. */
  function orderOf(): string {
    return zeilen.map((zeile) => `${zeile.ebene}:${zeile.punkt.id}`).join(',');
  }

  function kopfOf(id: string): HTMLElement | null {
    return container?.querySelector<HTMLElement>(`[data-punkt-kopf="${id}"]`) ?? null;
  }

  /** Applies a move; the items keep their content, the editor saves on its own. */
  async function apply(result: Verschiebung | null, punkt: ProtokollPunkt): Promise<void> {
    if (!result) return;
    punkte = result.punkte;
    meldungFehler = false;
    meldung = `„${titelOf(punkt)}“ ist jetzt Punkt ${result.nummer}`;
  }

  /** Why an arrow key on the handle cannot move the item. */
  function abgelehnt(key: string, index: number): string {
    const zeile = zeilen[index];
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const richtung = key === 'ArrowUp' ? 'oben' : 'unten';
      return zeile.ebene === 1
        ? `„${titelOf(zeile.punkt)}“ steht schon ganz ${richtung} in seinem Hauptpunkt. Mit der Pfeiltaste links wird er Hauptpunkt.`
        : `„${titelOf(zeile.punkt)}“ steht schon ganz ${richtung}.`;
    }
    if (key === 'ArrowLeft') {
      return `Die Tagesordnung hat schon ${MAX_PUNKTE} Hauptpunkte, mehr gehen nicht.`;
    }
    if (index === 0) return 'Der erste Punkt kann kein Unterpunkt werden.';
    if (zeile.punkt.unterpunkte.length > 0) {
      return 'Ein Punkt mit Unterpunkten kann kein Unterpunkt werden. Verschiebe zuerst seine Unterpunkte.';
    }
    return `Der Punkt darüber hat schon ${MAX_UNTERPUNKTE} Unterpunkte, mehr gehen nicht.`;
  }

  function movePunkt(at: number, delta: -1 | 1): void {
    if (drag || pending) return;
    const target = at + delta;
    if (target < 0 || target >= punkte.length) return;
    const [item] = punkte.splice(at, 1);
    punkte.splice(target, 0, item);
  }

  /** Arrow keys on the handle: up and down move, right and left change the level. */
  async function onkey(event: KeyboardEvent, id: string): Promise<void> {
    if (drag || pending) {
      if (event.key === 'Escape') cancel();
      return;
    }
    const index = zeilen.findIndex((zeile) => zeile.punkt.id === id);
    if (index < 0) return;
    const zeile = zeilen[index];
    let result: Verschiebung | null;
    if (event.key === 'ArrowUp') result = verschiebeSchritt(snapshot(), index, -1);
    else if (event.key === 'ArrowDown') result = verschiebeSchritt(snapshot(), index, 1);
    else if (event.key === 'ArrowRight' && zeile.ebene === 0)
      result = alsUnterpunkt(snapshot(), index);
    else if (event.key === 'ArrowLeft' && zeile.ebene === 1)
      result = alsHauptpunkt(snapshot(), index);
    else return;
    event.preventDefault();
    if (!result) {
      meldungFehler = true;
      meldung = abgelehnt(event.key, index);
      return;
    }
    await apply(result, zeile.punkt);
    await tick();
    const griff = document.getElementById(`griff-${id}`);
    griff?.focus({ preventScroll: true });
    griff?.scrollIntoView({ block: 'nearest' });
  }

  // --- Dragging ---

  function ondown(event: PointerEvent, id: string): void {
    if (event.button !== 0 || drag || pending) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const kopf = kopfOf(id);
    pending = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetY: kopf ? event.clientY - kopf.getBoundingClientRect().top : 0,
    };
    window.addEventListener('pointermove', onmove);
    window.addEventListener('pointerup', onup);
    window.addEventListener('pointercancel', cancel);
  }

  const griff: Griff = { down: ondown, key: (event, id) => void onkey(event, id) };

  function onmove(event: PointerEvent): void {
    if (pending && event.pointerId === pending.pointerId) {
      const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (distance >= START_PX) void begin(pending, event);
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    update();
  }

  /** Shrinks the items to their title rows, keeps the grabbed one under the pointer and measures. */
  async function begin(start: Pending, event: PointerEvent): Promise<void> {
    pending = null;
    const index = zeilen.findIndex((zeile) => zeile.punkt.id === start.id);
    if (index < 0 || !container) return end();
    ordering = true;
    meldung = '';
    await tick();
    const kopf = kopfOf(start.id);
    if (kopf) {
      const shift = kopf.getBoundingClientRect().top + start.offsetY - event.clientY;
      window.scrollBy({ top: shift, behavior: 'instant' });
    }
    rects = zeilen.map((zeile) => {
      const rect = kopfOf(zeile.punkt.id)?.getBoundingClientRect();
      return rect
        ? { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY }
        : { top: 0, bottom: 0 };
    });
    const box = container.getBoundingClientRect();
    containerTop = box.top + window.scrollY;
    dragged = container.querySelector<HTMLElement>(`[data-punkt="${start.id}"]`);
    const block = dragged?.getBoundingClientRect();
    dyRange = block
      ? { min: box.top - block.top, max: box.bottom - block.bottom }
      : { min: 0, max: 0 };
    dragged?.classList.add('is-dragged');
    maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    topInset = Math.max(
      0,
      ...[...document.querySelectorAll<HTMLElement>('body > header, [data-sticky-top]')].map(
        (element) => element.getBoundingClientRect().bottom
      )
    );
    // Bars fixed to the bottom (the bar of the Leitendenbereich on phones) cover the lower edge
    bottomInset = Math.max(
      0,
      ...[...document.querySelectorAll<HTMLElement>('[data-sticky-bottom]')]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => window.innerHeight - element.getBoundingClientRect().top)
    );
    drag = {
      order: orderOf(),
      from: index,
      length: blockLength(zeilen, index),
      pointerId: start.pointerId,
      startX: start.startX,
      startY: event.clientY + window.scrollY,
      clientX: event.clientX,
      clientY: event.clientY,
      to: index,
      ebene: zeilen[index].ebene,
    };
    update();
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  /** Where the dragged item would go: before the first remaining title row below the pointer. */
  function update(): void {
    if (!drag) return;
    const pageY = drag.clientY + window.scrollY;
    const dx = drag.clientX - drag.startX;
    const dy = Math.max(dyRange.min, Math.min(dyRange.max, pageY - drag.startY));
    if (dragged) {
      dragged.style.transform = `translate(${Math.max(-48, Math.min(48, dx))}px, ${dy}px)`;
    }
    let to = 0;
    rects.forEach((rect, index) => {
      if (index >= drag!.from && index < drag!.from + drag!.length) return;
      if ((rect.top + rect.bottom) / 2 < pageY) to++;
    });
    const eigene = zeilen[drag.from].ebene;
    const wunsch = dx > EBENE_PX ? 1 : dx < -EBENE_PX ? 0 : eigene;
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
    else if (clientY > window.innerHeight - bottomInset - SCROLL_EDGE_PX)
      delta = Math.ceil((clientY - window.innerHeight + bottomInset + SCROLL_EDGE_PX) / 6);
    // Stop at the top and at the end of the page as it was when dragging started
    delta = Math.max(-window.scrollY, Math.min(delta, maxScroll - window.scrollY));
    if (delta !== 0) {
      window.scrollBy({ top: delta, behavior: 'instant' });
      update();
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  async function onup(event: PointerEvent): Promise<void> {
    if (pending && event.pointerId === pending.pointerId) return end();
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { order, from, to, ebene, clientY } = drag;
    // The rows were measured for this order; if it changed meanwhile, the drop would hit the wrong item
    if (orderOf() !== order) {
      cancel();
      return;
    }
    const punkt = zeilen[from].punkt;
    const kopf = kopfOf(punkt.id);
    const offset = kopf ? clientY - kopf.getBoundingClientRect().top : 0;
    end();
    if (ebene === null) {
      meldungFehler = true;
      meldung =
        'Dort passt der Punkt nicht hin. Ein Punkt mit Unterpunkten bleibt ein Hauptpunkt, zwischen Unterpunkten ist nur ein Unterpunkt möglich.';
    } else {
      await apply(verschiebe(snapshot(), from, to, ebene), punkt);
    }
    // Opening the items again keeps the moved one where it was let go
    await tick();
    const moved = kopfOf(punkt.id);
    if (moved) {
      const shift = moved.getBoundingClientRect().top + offset - clientY;
      window.scrollBy({ top: shift, behavior: 'instant' });
    }
    document.getElementById(`griff-${punkt.id}`)?.focus({ preventScroll: true });
  }

  function cancel(): void {
    const wasDragging = drag !== null;
    end();
    if (wasDragging) {
      meldungFehler = false;
      meldung = 'Verschieben abgebrochen.';
    }
  }

  function end(): void {
    cancelAnimationFrame(scrollFrame);
    window.removeEventListener('pointermove', onmove);
    window.removeEventListener('pointerup', onup);
    window.removeEventListener('pointercancel', cancel);
    if (dragged) {
      dragged.style.transform = '';
      dragged.classList.remove('is-dragged');
    }
    dragged = null;
    pending = null;
    drag = null;
    ordering = false;
  }

  // Leaving the editor while dragging must not leave the page scrolling
  $effect(() => end);

  /** Position and label of the line where the dragged item would land. */
  const ziel = $derived.by(() => {
    if (!drag) return null;
    const rest = zeilen
      .map((zeile, index) => ({ zeile, index }))
      .filter(({ index }) => index < drag!.from || index >= drag!.from + drag!.length);
    const next = rest[drag.to];
    const before = rest[drag.to - 1];
    const y = next
      ? rects[next.index].top - containerTop - 6
      : before
        ? rects[before.index].bottom - containerTop + 6
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
    if ((drag || pending) && event.key === 'Escape') cancel();
  }}
/>

<p class="text-sm text-neutral-700">
  Punkte am Griff
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
  verschieben. Nach rechts gezogen wird ein Punkt Unterpunkt, nach links Hauptpunkt.
</p>

{#snippet markdownListe()}
  {#each punkte as punkt, at (punkt.id)}
    <div class="border-t border-neutral-200 pt-4">
      <ProtokollPunktEditor
        bind:punkt={punkte[at]}
        index={at}
        count={punkte.length}
        {personen}
        onmove={(delta) => movePunkt(at, delta)}
        onremove={() => confirmRemove(punkte[at], `${at + 1}.`, () => punkte.splice(at, 1))}
        {confirmRemove}
        {griff}
      />
    </div>
  {/each}
{/snippet}

<div bind:this={container} class="tagesordnung relative space-y-6" class:is-ordering={ordering}>
  {#if textModus === 'formatiert'}
    <!-- The document editor is loaded only when it is used; the Markdown fields cost nothing -->
    {#await import('./ProtokollDokument.svelte')}
      <div class="skeleton-element h-48 rounded-md" role="status" aria-live="polite">
        <span class="sr-only">Editor wird geladen …</span>
      </div>
    {:then dokument}
      <dokument.default bind:punkte {personen} {confirmRemove} {griff} {onactive} />
    {:catch}
      <p class="text-sm text-danger" role="alert">
        Der Formatierungs-Editor konnte nicht geladen werden, der Text ist unverändert. Lade die
        Seite neu und wähle „Formatiert“ noch einmal, oder schreibe hier in Markdown weiter.
      </p>
      {@render markdownListe()}
    {/await}
  {:else}
    {@render markdownListe()}
  {/if}
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

<style>
  .is-ordering {
    user-select: none;
    -webkit-user-select: none;
  }
  /* While dragging, only the handle reacts; a second finger changes nothing */
  .is-ordering :global(:is(button, input, textarea):not(.griff)) {
    pointer-events: none;
  }
  .is-ordering > div {
    padding-top: 0.5rem;
  }
  .tagesordnung.is-ordering {
    row-gap: 0.5rem;
  }
  .tagesordnung :global(.is-dragged) {
    position: relative;
    z-index: 4;
    background: var(--color-neutral-50);
    box-shadow: 0 0.25rem 0.75rem rgb(0 0 0 / 0.18);
    opacity: 0.92;
  }
  .ziel {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 5;
    border-top: 3px solid var(--color-action);
    pointer-events: none;
    transform: translateY(-1.5px);
  }
  .ziel.is-sub {
    left: 2.75rem;
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
