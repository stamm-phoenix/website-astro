import assert from 'node:assert/strict';
import test from 'node:test';
import type { NikolausSettings } from '../lib/nikolaus-config';
import { loadNikolausSettings, saveNikolausSettings } from '../lib/nikolaus-settings';
import {
  NIKOLAUS_SETTINGS_TTL_MS,
  invalidateNikolausSettingsCache,
  readCachedNikolausSettings,
} from '../lib/nikolaus-settings-cache';
import { getNikolausSettings } from '../lib/nikolaus-settings';
import { getNikolausSettingsForRead } from '../lib/nikolaus-staff';
import { dbTest } from './fixtures/database';
import { TEST_SETTINGS } from './fixtures/nikolaus-settings';
import { getDb } from '../lib/db';

function loader(settings: NikolausSettings[]): {
  load: () => Promise<NikolausSettings>;
  calls: () => number;
} {
  let calls = 0;
  return {
    load: async () => settings[Math.min(calls++, settings.length - 1)],
    calls: () => calls,
  };
}

const ON = TEST_SETTINGS;
const OFF: NikolausSettings = { ...TEST_SETTINGS, staffActive: false };

test('the settings are loaded once within the lifetime and again after it', async () => {
  invalidateNikolausSettingsCache();
  const { load, calls } = loader([ON, OFF]);
  const start = 1_000_000;
  assert.equal(await readCachedNikolausSettings(load, start), ON);
  assert.equal(await readCachedNikolausSettings(load, start + NIKOLAUS_SETTINGS_TTL_MS - 1), ON);
  assert.equal(calls(), 1);
  assert.equal(await readCachedNikolausSettings(load, start + NIKOLAUS_SETTINGS_TTL_MS), OFF);
  assert.equal(calls(), 2);
});

test('concurrent reads share one load', async () => {
  invalidateNikolausSettingsCache();
  const { load, calls } = loader([ON]);
  await Promise.all([1, 2, 3, 4].map(() => readCachedNikolausSettings(load, 5)));
  assert.equal(calls(), 1);
});

test('invalidating makes the next read load again', async () => {
  invalidateNikolausSettingsCache();
  const { load, calls } = loader([ON, OFF]);
  assert.equal(await readCachedNikolausSettings(load, 10), ON);
  invalidateNikolausSettingsCache();
  assert.equal(await readCachedNikolausSettings(load, 11), OFF);
  assert.equal(calls(), 2);
});

test('a failed load is not remembered, and another loader never sees an old value', async () => {
  invalidateNikolausSettingsCache();
  let attempts = 0;
  const failing = async (): Promise<NikolausSettings> => {
    if (attempts++ === 0) throw new Error('database unavailable');
    return ON;
  };
  await assert.rejects(readCachedNikolausSettings(failing, 20), /database unavailable/);
  assert.equal(await readCachedNikolausSettings(failing, 21), ON);
  const other = loader([OFF]);
  assert.equal(await readCachedNikolausSettings(other.load, 22), OFF);
});

dbTest('saving in the Steuerung drops the cache at once', async () => {
  const stored = await loadNikolausSettings();
  assert.equal((await getNikolausSettingsForRead()).maintenance, false);
  await saveNikolausSettings({ ...stored.settings, maintenance: true }, stored.etag, 'test');
  // No waiting for the lifetime: the same instance sees what it saved
  assert.equal((await getNikolausSettingsForRead()).maintenance, true);
});

dbTest('reads may be a few seconds old, but the settings that writes read are fresh', async () => {
  assert.equal((await getNikolausSettingsForRead()).maintenance, false);
  // Changed behind the cache, as another instance would do
  await getDb().updateTable('nikolaus.settings').set({ maintenance: true }).execute();
  assert.equal((await getNikolausSettingsForRead()).maintenance, false);
  assert.equal((await getNikolausSettings()).maintenance, true);
});
