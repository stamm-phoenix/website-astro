import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  loadStaffSettings,
  saveStaffSetting,
  settingsStore,
} from '../src/lib/staffSettingsStore.svelte';
import { gate, json, stubFetch } from './fixtures/fetch-stub';

/** The settings of a person are saved on the server; late answers must not undo a newer choice. */

let stub: ReturnType<typeof stubFetch> | null = null;
afterEach(() => stub?.restore());

function choice(call: { body: unknown }): string {
  return (call.body as { settings: { protokollText: string } }).settings.protokollText;
}

test('two quick choices are saved one after another and the last one stays, also when the first answers late', async () => {
  const firstAnswer = gate();
  const server = { protokollText: 'formatiert' };
  stub = stubFetch(async (call) => {
    if (call.method === 'GET') return json({ settings: server });
    if (choice(call) === 'markdown') await firstAnswer.promise;
    server.protokollText = choice(call);
    return json({ settings: { ...server } });
  });
  const first = saveStaffSetting('protokollText', 'markdown');
  const second = saveStaffSetting('protokollText', 'formatiert');
  // Shown at once, before any answer
  assert.equal(settingsStore.settings.protokollText, 'formatiert');
  // The second save waits for the first
  await Promise.resolve();
  assert.equal(stub.calls.length, 1);
  firstAnswer.open();
  await first;
  // The answer of the first save holds its own choice; the newer one stays shown meanwhile
  assert.equal(settingsStore.settings.protokollText, 'formatiert');
  await second;
  assert.deepEqual(
    stub.calls.map((call) => choice(call)),
    ['markdown', 'formatiert']
  );
  assert.equal(server.protokollText, 'formatiert');
  assert.equal(settingsStore.settings.protokollText, 'formatiert');
});

test('a failed save does not stop the next one and tells only its own caller', async () => {
  stub = stubFetch((call) =>
    choice(call) === 'markdown'
      ? json({}, 500)
      : json({ settings: { protokollText: 'formatiert' } })
  );
  const first = saveStaffSetting('protokollText', 'markdown');
  const second = saveStaffSetting('protokollText', 'formatiert');
  await assert.rejects(first);
  await second;
  assert.equal(settingsStore.settings.protokollText, 'formatiert');
});

test('a choice that cannot be saved still applies to the open page', async () => {
  stub = stubFetch(() => json({}, 500));
  await assert.rejects(saveStaffSetting('protokollText', 'markdown'));
  assert.equal(settingsStore.settings.protokollText, 'markdown');
});

test('a choice made while the settings load is not taken back by their late answer', async () => {
  const lateAnswer = gate();
  stub = stubFetch(async (call) => {
    if (call.method === 'GET') {
      await lateAnswer.promise;
      return json({ settings: { protokollText: 'formatiert' } });
    }
    return json({ settings: { protokollText: 'markdown' } });
  });
  const loading = loadStaffSettings();
  await saveStaffSetting('protokollText', 'markdown');
  lateAnswer.open();
  await loading;
  assert.equal(settingsStore.settings.protokollText, 'markdown');
});

test('an older load answering after a newer one does not bring an outdated choice back', async () => {
  const firstAnswer = gate();
  let reads = 0;
  stub = stubFetch(async () => {
    // The first read was served before the other device chose, and arrives last
    if (++reads === 1) {
      await firstAnswer.promise;
      return json({ settings: {} });
    }
    return json({ settings: { protokollText: 'markdown' } });
  });
  const first = loadStaffSettings();
  await loadStaffSettings();
  assert.equal(settingsStore.settings.protokollText, 'markdown');
  firstAnswer.open();
  await first;
  assert.equal(settingsStore.settings.protokollText, 'markdown');
});

test('a load takes over a choice made on another device', async () => {
  stub = stubFetch(() => json({ settings: { protokollText: 'formatiert' } }));
  await loadStaffSettings();
  assert.equal(settingsStore.settings.protokollText, 'formatiert');
  stub.restore();
  stub = stubFetch(() => json({ settings: { protokollText: 'markdown' } }));
  await loadStaffSettings();
  assert.equal(settingsStore.settings.protokollText, 'markdown');
});

test('a failed load keeps the known values', async () => {
  stub = stubFetch(() => json({ settings: { protokollText: 'markdown' } }));
  await loadStaffSettings();
  stub.restore();
  stub = stubFetch(() => json({}, 503));
  await loadStaffSettings();
  assert.equal(settingsStore.settings.protokollText, 'markdown');
});

test('a load that starts while a save runs asks the server after the save', async () => {
  const saved = gate();
  const server = { protokollText: 'formatiert' };
  stub = stubFetch(async (call) => {
    if (call.method === 'GET') return json({ settings: { ...server } });
    await saved.promise;
    server.protokollText = choice(call);
    return json({ settings: { ...server } });
  });
  const saving = saveStaffSetting('protokollText', 'markdown');
  const loading = loadStaffSettings();
  await Promise.resolve();
  saved.open();
  await Promise.all([saving, loading]);
  assert.deepEqual(
    stub.calls.map(({ method }) => method),
    ['PUT', 'GET']
  );
  assert.equal(settingsStore.settings.protokollText, 'markdown');
});
