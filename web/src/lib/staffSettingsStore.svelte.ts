import { fetchApi, sendApi } from './api';
import { pickStaffSettings } from '../../../api/lib/staff-settings-model';
import type { StaffSettings } from '../../../api/lib/staff-settings-model';

/**
 * Settings of the logged-in person, saved on the server (`/api/intern/einstellungen`), so a
 * choice made on one device applies on every other. Loaded once per page; a missing key means
 * the default of the place applies (`staff-settings-model.ts`).
 */

const ENDPOINT = '/intern/einstellungen';

interface SettingsState {
  settings: StaffSettings;
  loaded: boolean;
}

export const settingsStore = $state<SettingsState>({ settings: {}, loaded: false });

let loading: Promise<void> | null = null;

/**
 * Loads the settings; the same call is shared while it runs. A failed load leaves the defaults
 * in place and is not reported: the page works without, and a later save tries the server again.
 */
export function loadStaffSettings(): Promise<void> {
  if (settingsStore.loaded) return Promise.resolve();
  loading ??= (async () => {
    try {
      const { settings } = await fetchApi<{ settings: unknown }>(ENDPOINT);
      settingsStore.settings = pickStaffSettings(settings);
      settingsStore.loaded = true;
    } catch {
      // Defaults apply; nothing to tell the person here
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Saves one setting; the value is shown at once, the save may still fail (the caller says so). */
export async function saveStaffSetting<K extends keyof StaffSettings>(
  key: K,
  value: NonNullable<StaffSettings[K]>
): Promise<void> {
  settingsStore.settings = { ...settingsStore.settings, [key]: value };
  const { settings } = await sendApi<{ settings: unknown }>('PUT', ENDPOINT, {
    settings: { [key]: value },
  });
  settingsStore.settings = pickStaffSettings(settings);
  settingsStore.loaded = true;
}
