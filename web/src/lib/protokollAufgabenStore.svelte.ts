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
 * Tasks ticked off or opened again on this page, by ID. Every item showing the task follows,
 * also the one where it was not ticked.
 */
export const erledigtStand = $state<{ byId: Record<number, boolean> }>({ byId: {} });

/** Ticks a task off in the module Aufgaben, or opens it again. Throws `ApiError`. */
export async function setAufgabeErledigt(id: number, erledigt: boolean): Promise<void> {
  await sendApi('PUT', `/intern/pflege/protokoll-editor-aufgaben/${id}`, { erledigt });
  erledigtStand.byId[id] = erledigt;
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
