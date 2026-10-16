import { navigate } from 'astro:transitions/client';
import type { TransitionBeforePreparationEvent } from 'astro:transitions/client';
import { confirmAction, type ConfirmOptions } from './confirm';

/**
 * Warns before unsaved changes get lost. `beforeunload` alone is not enough because the
 * Astro ClientRouter swaps pages without unloading the document, so its navigations
 * (links, back/forward, `navigate()`) are checked in `astro:before-preparation` and asked in
 * the app's own dialog. Reloading or closing the tab keeps the browser's own warning.
 */

export const UNSAVED_MESSAGE =
  'Es gibt ungespeicherte Änderungen. Seite trotzdem verlassen? Die Änderungen gehen dabei verloren.';

/** Registered checks with the question each asks instead of the default one. */
const guards = new Map<() => boolean, LeavePrompt | undefined>();
/** History index of the guarded page, as stored by the ClientRouter in `history.state`. */
let pageIndex: number | null = null;
/** Set once the user confirmed leaving, so a fallback full page load does not ask again. */
let leaving = false;
/** Set while a back/forward navigation is being undone until the user has answered. */
let restoring = false;
/** Set while the dialog is open; other navigations meanwhile are stopped without asking again. */
let asking = false;

/** Whether any registered guard reports unsaved changes, unless leaving was confirmed. */
function hasUnsavedChanges(): boolean {
  return dirtyPrompt() !== null;
}

/** The question of the first guard that reports unsaved changes; null if there are none. */
function dirtyPrompt(): LeavePrompt | null {
  if (leaving) return null;
  for (const [isDirty, prompt] of guards) if (isDirty()) return prompt ?? DEFAULT_PROMPT;
  return null;
}

/** Reads the ClientRouter's history index of the current entry. */
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

/** Lets the browser ask before reloading or closing the tab. */
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (hasUnsavedChanges()) event.preventDefault();
}

/** The question before leaving, e.g. for a running upload instead of unsaved changes. */
export type LeavePrompt = Pick<
  ConfirmOptions,
  'title' | 'message' | 'confirmLabel' | 'cancelLabel'
>;

const DEFAULT_PROMPT: LeavePrompt = {
  title: 'Änderungen verwerfen?',
  message:
    'Deine Änderungen sind noch nicht gespeichert. Wenn du die Seite verlässt, gehen sie verloren.',
  confirmLabel: 'Änderungen verwerfen',
  cancelLabel: 'Weiter bearbeiten',
};

/** Asks in the app's dialog whether to leave; true when the user discards the changes. */
function confirmLeaving(): Promise<boolean> {
  return confirmAction(dirtyPrompt() ?? DEFAULT_PROMPT);
}

/**
 * Stops a ClientRouter navigation while there are unsaved changes and asks first. The dialog
 * cannot block the router, so the navigation is stalled, back/forward is undone, and the
 * navigation is started again once the user discards the changes.
 */
function onBeforePreparation(event: TransitionBeforePreparationEvent): void {
  if (restoring) {
    // The step back to the guarded page after a back/forward navigation.
    restoring = false;
    stall(event);
    return;
  }
  if (!hasUnsavedChanges()) return;
  stall(event);
  // Back/forward has already changed the URL: return to the guarded entry while asking.
  const target = historyIndex();
  const delta =
    event.navigationType === 'traverse' && target !== null && pageIndex !== null
      ? target - pageIndex
      : null;
  if (delta !== null) {
    restoring = true;
    history.go(-delta);
  }
  if (asking) return;
  asking = true;
  void confirmLeaving().then((discard) => {
    asking = false;
    if (!discard) return;
    leaving = true;
    if (delta !== null) history.go(delta);
    else
      void navigate(event.to.href, {
        history: event.navigationType === 'replace' ? 'replace' : 'push',
      });
  });
}

/** Resets the state for the newly shown page. */
function onAfterSwap(): void {
  leaving = false;
  pageIndex = historyIndex();
}

/** Starts listening once the first guard is registered. */
function install(): void {
  leaving = false;
  restoring = false;
  asking = false;
  pageIndex = historyIndex();
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('astro:before-preparation', onBeforePreparation);
  document.addEventListener('astro:after-swap', onAfterSwap);
}

/** Stops listening after the last guard is removed. */
function uninstall(): void {
  window.removeEventListener('beforeunload', onBeforeUnload);
  document.removeEventListener('astro:before-preparation', onBeforePreparation);
  document.removeEventListener('astro:after-swap', onAfterSwap);
}

/**
 * Asks before leaving the page (internal links, back/forward, reload, closing the tab)
 * while `isDirty` returns true; `prompt` replaces the question about unsaved changes. Returns the cleanup function, e.g. for `onMount`/`$effect`.
 */
export function guardUnsavedChanges(isDirty: () => boolean, prompt?: LeavePrompt): () => void {
  if (guards.size === 0) install();
  guards.set(isDirty, prompt);
  return () => {
    guards.delete(isDirty);
    if (guards.size === 0) uninstall();
  };
}
