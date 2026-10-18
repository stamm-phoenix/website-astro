import { ApiError, sendApi } from './api';
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

/** Versions returned by ticking, newer than those of the last load. */
let versionen: Record<number, string> = {};
/** Ticks still on their way; finishing the writing waits for them. Nothing renders from it. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const pending = new Set<Promise<unknown>>();

/** Starts the minutes of a newly opened editor with nothing ticked. */
export function resetAufgabenStand(): void {
  erledigtStand.byId = {};
  versionen = {};
}

/**
 * Ticks a task off in the module Aufgaben, or opens it again, if it did not change since it was
 * loaded. Throws `ApiError` (409 if someone changed it meanwhile).
 */
export async function setAufgabeErledigt(id: number, erledigt: boolean): Promise<void> {
  const request = (async () => {
    let etag: string | undefined = versionen[id] ?? protokollAufgaben.state.data?.versionen[id];
    if (!etag) {
      await protokollAufgaben.load({ force: true });
      etag = protokollAufgaben.state.data?.versionen[id];
    }
    let result: { etag: string };
    try {
      result = await sendApi<{ etag: string }>(
        'PUT',
        `/intern/pflege/protokoll-editor-aufgaben/${id}`,
        { erledigt, etag }
      );
    } catch (error: unknown) {
      // Changed by someone else: the next tap uses the current version
      if (error instanceof ApiError && error.status === 409) {
        delete versionen[id];
        await protokollAufgaben.load({ force: true });
      }
      throw error;
    }
    versionen[id] = result.etag;
    erledigtStand.byId[id] = erledigt;
  })();
  pending.add(request);
  try {
    await request;
  } finally {
    pending.delete(request);
  }
}

/** Waits until every tick on its way is answered, so the minutes save their final state. */
export async function aufgabenAbwarten(): Promise<void> {
  await Promise.allSettled([...pending]);
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
