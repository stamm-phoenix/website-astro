import { createResource } from './pflegeStore.svelte';
import type { StaffNikolausStatus } from './types';

const status = createResource<StaffNikolausStatus>('/intern/nikolaus/status');

/** Whether the Nikolaus modules are on and whether the data is due for deletion. */
export const nikolausStatusStore = status.state;

/** Loads the status once per page; reuses a running request. */
export function fetchNikolausStatus(): Promise<void> {
  return status.load();
}
