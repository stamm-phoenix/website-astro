import type { NikolausSettings } from './nikolaus-config';

/**
 * A short-lived memory of the Nikolaus settings for the checks of read requests (are the
 * staff modules switched on?). The Steuerung drops it as soon as it saved, so a change shows
 * at once on the instance that saved and after at most `TTL_MS` on the others.
 *
 * Never use it for writes, for the maintenance mode or inside a transaction: those read the
 * settings fresh (`getNikolausSettings`, `loadNikolausDays`, `assertTeamsConfigured`).
 */
export const NIKOLAUS_SETTINGS_TTL_MS = 5_000;

interface Entry {
  load: () => Promise<NikolausSettings>;
  expiresAt: number;
  value: Promise<NikolausSettings>;
}

let entry: Entry | undefined;

/**
 * The settings from `load`, reused for a few seconds. A different `load` function starts a
 * new entry, so tests that replace the loader never see the value of an earlier one.
 */
export function readCachedNikolausSettings(
  load: () => Promise<NikolausSettings>,
  now: number = Date.now()
): Promise<NikolausSettings> {
  if (entry && entry.load === load && entry.expiresAt > now) return entry.value;
  const value = load();
  const created: Entry = { load, expiresAt: now + NIKOLAUS_SETTINGS_TTL_MS, value };
  entry = created;
  // A failed load is not remembered
  value.catch(() => {
    if (entry === created) entry = undefined;
  });
  return value;
}

/** Called after the Steuerung saved; the next read loads the new settings. */
export function invalidateNikolausSettingsCache(): void {
  entry = undefined;
}
