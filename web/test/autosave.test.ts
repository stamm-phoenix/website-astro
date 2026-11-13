import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Autosave, type SaveStart } from '../src/lib/autosave';
import { RETRY_MS, SAVE_DELAY_MS, SAVE_MAX_WAIT_MS } from '../src/lib/protokollSpeichern';
import { FakeClock, settle } from './fixtures/fake-clock';
import { gate, type Gate } from './fixtures/fetch-stub';

/** When the automatic saving runs: quiet time, longest wait, one save at a time, retries. */

interface Harness {
  clock: FakeClock;
  autosave: Autosave;
  /** Number of saves started. */
  runs: () => number;
  /** Each started save, held until the test opens it. */
  requests: Gate[];
}

function harness(
  options: { active?: () => boolean; start?: () => 'unchanged' | 'invalid' | null } = {}
): Harness {
  const clock = new FakeClock();
  const requests: Gate[] = [];
  let runs = 0;
  const autosave = new Autosave({
    active: options.active ?? (() => true),
    run: (): SaveStart => {
      runs++;
      const early = options.start?.() ?? null;
      if (early) return early;
      const request = gate();
      requests.push(request);
      return request.promise;
    },
    clock,
  });
  return { clock, autosave, runs: () => runs, requests };
}

test('a save follows the quiet time after the last change', async () => {
  const { clock, autosave, runs } = harness();
  autosave.schedule();
  await clock.advance(SAVE_DELAY_MS - 100);
  autosave.schedule();
  await clock.advance(SAVE_DELAY_MS - 100);
  assert.equal(runs(), 0);
  await clock.advance(100);
  assert.equal(runs(), 1);
});

test('while changes keep coming, the save runs after the longest wait', async () => {
  const { clock, autosave, runs } = harness();
  for (let waited = 0; waited < SAVE_MAX_WAIT_MS; waited += 500) {
    autosave.schedule();
    await clock.advance(500);
  }
  assert.equal(runs(), 1);
});

test('a change during a save leads to exactly one more save once it is done', async () => {
  const { autosave, runs, requests } = harness();
  void autosave.save();
  assert.equal(autosave.saving, true);
  void autosave.save();
  void autosave.save();
  assert.equal(runs(), 1);
  requests[0].open();
  await settle();
  assert.equal(runs(), 2);
  requests[1].open();
  await settle();
  assert.equal(runs(), 2);
  assert.equal(autosave.saving, false);
});

test('flush waits for the save on its way and the one that follows it', async () => {
  const { autosave, requests } = harness();
  void autosave.save();
  let flushed = false;
  const flushing = autosave.flush().then(() => (flushed = true));
  await settle();
  // The flush asked for another save while the first was on its way
  requests[0].open();
  await settle();
  assert.equal(flushed, false);
  assert.equal(requests.length, 2);
  requests[1].open();
  await flushing;
  assert.equal(flushed, true);
});

test('flush cancels the planned save and saves at once', async () => {
  const { clock, autosave, runs, requests } = harness();
  autosave.schedule();
  const flushing = autosave.flush();
  assert.equal(runs(), 1);
  requests[0].open();
  await flushing;
  await clock.advance(SAVE_DELAY_MS * 2);
  assert.equal(runs(), 1);
});

test('nothing is saved while saving is not possible', async () => {
  let active = false;
  const { clock, autosave, runs, requests } = harness({ active: () => active });
  autosave.schedule();
  await clock.advance(SAVE_DELAY_MS);
  await autosave.flush();
  assert.equal(runs(), 0);
  active = true;
  const flushing = autosave.flush();
  assert.equal(runs(), 1);
  requests[0].open();
  await flushing;
});

test('retries wait longer after every failure, until a save goes through', async () => {
  const { clock, autosave, runs, requests } = harness();
  // Each failed save plans the next attempt
  const fail = async (): Promise<void> => {
    autosave.retryLater();
    requests.at(-1)?.open();
    await settle();
  };
  await fail();
  assert.deepEqual(clock.pending(), [RETRY_MS[0]]);
  await clock.advance(RETRY_MS[0]);
  assert.equal(runs(), 1);
  await fail();
  assert.deepEqual(clock.pending(), [RETRY_MS[1]]);
  await clock.advance(RETRY_MS[1]);
  assert.equal(runs(), 2);
  autosave.succeeded();
  await fail();
  assert.deepEqual(clock.pending(), [RETRY_MS[0]]);
});

test('invalid input keeps the time of the first change, so the longest wait still counts', async () => {
  let start: 'invalid' | 'unchanged' | null = 'invalid';
  const { clock, autosave, runs } = harness({ start: () => start });
  autosave.schedule();
  await clock.advance(SAVE_DELAY_MS);
  assert.equal(runs(), 1);
  await clock.advance(SAVE_MAX_WAIT_MS);
  start = null;
  autosave.schedule();
  // Longer than the longest wait since the first change: saved at once
  await clock.advance(0);
  assert.equal(runs(), 2);
});

test('a save with nothing changed starts the longest wait anew', async () => {
  let start: 'invalid' | 'unchanged' | null = 'unchanged';
  const { clock, autosave, runs } = harness({ start: () => start });
  autosave.schedule();
  await clock.advance(SAVE_MAX_WAIT_MS * 2);
  assert.equal(runs(), 1);
  start = null;
  autosave.schedule();
  await clock.advance(SAVE_DELAY_MS - 1);
  assert.equal(runs(), 1);
  await clock.advance(1);
  assert.equal(runs(), 2);
});
