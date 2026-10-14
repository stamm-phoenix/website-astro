import { createResource } from './pflegeStore.svelte';
import type { StaffNikolausStatus } from './types';

const status = createResource<StaffNikolausStatus>('/intern/nikolaus/status');

/** Whether the Nikolaus modules are on and whether the data is due for deletion. */
export const nikolausStatusStore = status.state;

/** Loads the status once; reuses a running request. */
export function fetchNikolausStatus(): Promise<void> {
  return status.load();
}

/**
 * Loads the status again after the Steuerung changed it. Astro navigation keeps the loaded
 * status, so the menu and the notices would otherwise show the old modules.
 */
export function refreshNikolausStatus(): Promise<void> {
  return status.load({ force: true });
}
