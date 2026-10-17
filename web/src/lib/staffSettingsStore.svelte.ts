import { fetchApi, sendApi } from './api';
import { pickStaffSettings } from '../../../api/lib/staff-settings-model';
import type { StaffSettings } from '../../../api/lib/staff-settings-model';

/**
 * Settings of the logged-in person, saved on the server (`/api/intern/einstellungen`), so a
 * choice made on one device applies on every other. Loaded whenever a page that uses them opens;
 * a missing key means the default of the place applies (`staff-settings-model.ts`).
 */

const ENDPOINT = '/intern/einstellungen';

interface SettingsState {
  settings: StaffSettings;
}

export const settingsStore = $state<SettingsState>({ settings: {} });

/** Saves run one after another, so an older choice never overwrites a newer one on the server. */
let queue: Promise<void> = Promise.resolve();

/** Counts the choices; an answer from the server applies only while no newer choice was made. */
let generation = 0;

/**
 * Loads the settings from the server. It runs on every opening of a page, also when the page
 * script stays alive between internal links, so a change made on another device meanwhile is
 * taken over. Saves still running finish first, so the answer has them; a choice made while the
 * load runs wins over its answer. A failed load leaves the known values in place and is not
 * reported: the page works without, and the next save tries the server again.
 */
export async function loadStaffSettings(): Promise<void> {
  const before = generation;
  try {
    await queue;
    const { settings } = await fetchApi<{ settings: unknown }>(ENDPOINT);
    if (generation !== before) return;
    settingsStore.settings = pickStaffSettings(settings);
  } catch {
    // Defaults or the known values apply; nothing to tell the person here
  }
}

/**
 * Saves one setting after all earlier saves. The value is shown at once; the save may still fail
 * (the caller says so), and the shown value stays, so the next choice saves it again.
 */
export function saveStaffSetting<K extends keyof StaffSettings>(
  key: K,
  value: NonNullable<StaffSettings[K]>
): Promise<void> {
  const mine = ++generation;
  settingsStore.settings = { ...settingsStore.settings, [key]: value };
  const save = queue.then(async () => {
    const { settings } = await sendApi<{ settings: unknown }>('PUT', ENDPOINT, {
      settings: { [key]: value },
    });
    // The answer holds this choice and the other keys as saved on the server. A newer choice is
    // already shown and brings its own answer.
    if (generation === mine) settingsStore.settings = pickStaffSettings(settings);
  });
  // A failed save does not stop the later ones; its error goes to the caller
  queue = save.catch(() => undefined);
  return save;
}
