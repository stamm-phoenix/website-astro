import type { NikolausConfig } from './nikolausConfig';
import { createResource } from './pflegeStore.svelte';
import type { LoadState } from './storeView';

const settings = createResource<NikolausConfig>('/nikolaus/settings');

/** The public settings of the Nikolausdienst (days, times, service area) from the Steuerung. */
export const nikolausSettingsStore: LoadState<NikolausConfig> = {
  get data() {
    return settings.state.data;
  },
  get loading() {
    return settings.state.loading;
  },
  get error() {
    return settings.state.error !== null;
  },
};

/** Loads the settings once per page; reuses a running request. */
export function fetchNikolausSettings(): Promise<void> {
  return settings.load();
}
