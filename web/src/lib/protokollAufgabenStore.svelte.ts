import { sendApi } from './api';
import { createResource } from './pflegeStore.svelte';
import type { ProtokollAktion, ProtokollEditorAufgaben, ProtokollProjektOption } from './types';

/**
 * The module Aufgaben in the Protokoll-Editor (#277, step 3): its projects, to link one to an
 * agenda item, and its open tasks, to show and tick them off in the meeting. Loaded when the
 * writing starts.
 */
export const protokollAufgaben = createResource<ProtokollEditorAufgaben>(
  '/intern/protokoll-editor-aufgaben',
  { idle: true }
);

/**
 * Tasks ticked off or opened again in the minutes open now, by ID: every item showing the task
 * follows, also the one where it was not ticked. Cleared when an editor opens, so another set of
 * minutes keeps what was ticked in its own meeting.
 */
export const erledigtStand = $state<{ byId: Record<number, boolean> }>({ byId: {} });

/**
 * Changes of the editor still on their way: ticks and project links (`aenderung`) and reloads of
 * the open tasks (`neuladen`). Finishing the writing waits for all of them; a reload waits only
 * for the changes, so it never waits for itself. Nothing renders from them.
 */
const pending = { aenderung: new Set<Promise<unknown>>(), neuladen: new Set<Promise<unknown>>() };

/** Starts the minutes of a newly opened editor with nothing ticked. */
export function resetAufgabenStand(): void {
  erledigtStand.byId = {};
}

/**
 * Runs a change that ends in the minutes, so finishing the writing waits until its result is in
 * the document. It counts from the moment it is called.
 */
export async function laufend<T>(
  work: () => Promise<T>,
  art: keyof typeof pending = 'aenderung'
): Promise<T> {
  const running = work();
  pending[art].add(running);
  try {
    return await running;
  } finally {
    pending[art].delete(running);
  }
}

/** Whether a change or reload is still on its way; leaving the page now would lose it. */
export function aufgabenLaufen(): boolean {
  return pending.aenderung.size > 0 || pending.neuladen.size > 0;
}

/** Waits until every tick and project link on its way is done. */
export async function aenderungenAbwarten(): Promise<void> {
  await Promise.allSettled([...pending.aenderung]);
}

/** Waits until every change and reload on its way is done, so the minutes save their final state. */
export async function aufgabenAbwarten(): Promise<void> {
  await Promise.allSettled([...pending.aenderung, ...pending.neuladen]);
}

/**
 * Ticks a task off in the module Aufgaben, or opens it again, if it did not change since it was
 * last loaded. Throws `ApiError` (409 if someone changed it meanwhile).
 */
export async function setAufgabeErledigt(id: number, erledigt: boolean): Promise<void> {
  let etag = protokollAufgaben.state.data?.versionen[id];
  if (!etag) {
    await protokollAufgaben.load({ force: true });
    etag = protokollAufgaben.state.data?.versionen[id];
  }
  try {
    const result = await sendApi<{ etag: string }>(
      'PUT',
      `/intern/pflege/protokoll-editor-aufgaben/${id}`,
      { erledigt, etag }
    );
    // The next tap uses this version until the next load brings a newer one
    const data = protokollAufgaben.state.data;
    if (data) data.versionen[id] = result.etag;
    erledigtStand.byId[id] = erledigt;
  } finally {
    // Others may have changed it too; the reload brings the current versions
    void protokollAufgaben.load({ force: true });
  }
}

/** The project of the module Aufgaben for an Aktion, if there is one. */
export function projektFuerAktion(
  aktion: ProtokollAktion | null,
  data: ProtokollEditorAufgaben | null
): ProtokollProjektOption | null {
  if (!aktion || !data) return null;
  return data.projekte.find((projekt) => projekt.campflowId === aktion.id) ?? null;
}

/**
 * Creates a project in the module Aufgaben for an Aktion and returns it, after reloading the
 * list. Throws `ApiError`.
 */
export async function createProjektFuerAktion(
  aktion: ProtokollAktion
): Promise<ProtokollProjektOption | null> {
  await sendApi('POST', '/intern/pflege/aufgaben/projekte', {
    title: aktion.titel.trim().slice(0, 200),
    campflowId: aktion.id,
  });
  await protokollAufgaben.load({ force: true });
  return projektFuerAktion(aktion, protokollAufgaben.state.data);
}
