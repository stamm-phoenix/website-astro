import type { TransitionBeforePreparationEvent } from 'astro:transitions/client';

/**
 * Warns before unsaved changes get lost. `beforeunload` alone is not enough because the
 * Astro ClientRouter swaps pages without unloading the document, so its navigations
 * (links, back/forward, `navigate()`) are checked in `astro:before-preparation`.
 */

export const UNSAVED_MESSAGE =
  'Es gibt ungespeicherte Änderungen. Seite trotzdem verlassen? Die Änderungen gehen dabei verloren.';

const guards = new Set<() => boolean>();
/** History index of the guarded page, as stored by the ClientRouter in `history.state`. */
let pageIndex: number | null = null;
/** Set once the user confirmed leaving, so a fallback full page load does not ask again. */
let leaving = false;
/** Set while a cancelled back/forward navigation is being undone. */
let restoring = false;

function hasUnsavedChanges(): boolean {
  if (leaving) return false;
  for (const isDirty of guards) if (isDirty()) return true;
  return false;
}

function historyIndex(): number | null {
  const state: unknown = history.state;
  if (state && typeof state === 'object' && 'index' in state) {
    const { index } = state as { index: unknown };
    if (typeof index === 'number') return index;
  }
  return null;
}

/** Keeps the router from loading the page; the next navigation aborts the pending one. */
function stall(event: TransitionBeforePreparationEvent): void {
  event.loader = () => new Promise<void>(() => {});
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (hasUnsavedChanges()) event.preventDefault();
}

function onBeforePreparation(event: TransitionBeforePreparationEvent): void {
  if (restoring) {
    // The step back to the guarded page after a cancelled back/forward navigation.
    restoring = false;
    stall(event);
    return;
  }
  if (!hasUnsavedChanges()) return;
  if (window.confirm(UNSAVED_MESSAGE)) {
    leaving = true;
    return;
  }
  stall(event);
  // Back/forward has already changed the URL: return to the guarded entry.
  const target = historyIndex();
  if (event.navigationType === 'traverse' && target !== null && pageIndex !== null) {
    restoring = true;
    history.go(pageIndex - target);
  }
}

function onAfterSwap(): void {
  leaving = false;
  pageIndex = historyIndex();
}

function install(): void {
  leaving = false;
  restoring = false;
  pageIndex = historyIndex();
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('astro:before-preparation', onBeforePreparation);
  document.addEventListener('astro:after-swap', onAfterSwap);
}

function uninstall(): void {
  window.removeEventListener('beforeunload', onBeforeUnload);
  document.removeEventListener('astro:before-preparation', onBeforePreparation);
  document.removeEventListener('astro:after-swap', onAfterSwap);
}

/**
 * Asks before leaving the page (internal links, back/forward, reload, closing the tab)
 * while `isDirty` returns true. Returns the cleanup function, e.g. for `onMount`/`$effect`.
 */
export function guardUnsavedChanges(isDirty: () => boolean): () => void {
  if (guards.size === 0) install();
  guards.add(isDirty);
  return () => {
    guards.delete(isDirty);
    if (guards.size === 0) uninstall();
  };
}
