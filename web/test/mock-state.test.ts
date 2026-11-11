import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FreshMockState, type MockInstance } from '../scripts/mock-state';

/** Instances with ports 1, 2, …; `fail` makes the spawn with that number reject. */
function fakeSpawn(fail: number[] = []): {
  spawn: () => Promise<MockInstance>;
  stopped: number[];
  spawned: () => number;
} {
  let count = 0;
  const stopped: number[] = [];
  return {
    spawn: () => {
      const port = ++count;
      if (fail.includes(port)) return Promise.reject(new Error(`instance ${port} failed`));
      return Promise.resolve({ port, stop: () => stopped.push(port) });
    },
    stopped,
    spawned: () => count,
  };
}

/** Collects scheduled tasks, so a test decides when the grace period is over. */
function fakeSchedule(): {
  schedule: (task: () => void, ms: number) => void;
  run: () => void;
  delays: number[];
} {
  const tasks: (() => void)[] = [];
  const delays: number[] = [];
  return {
    schedule: (task, ms) => {
      tasks.push(task);
      delays.push(ms);
    },
    run: () => tasks.splice(0).forEach((task) => task()),
    delays,
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('fresh demo data per test', () => {
  test('serves the first instance and keeps a second one loaded', async () => {
    const instances = fakeSpawn();
    const state = new FreshMockState(instances.spawn, fakeSchedule().schedule);
    assert.equal(await state.port(), 1);
    assert.equal(instances.spawned(), 2);
  });

  test('a fresh start switches to the loaded spare and loads the next one', async () => {
    const instances = fakeSpawn();
    const state = new FreshMockState(instances.spawn, fakeSchedule().schedule);
    assert.equal(await state.fresh(), 2);
    assert.equal(await state.port(), 2);
    assert.equal(instances.spawned(), 3);
    assert.equal(await state.fresh(), 3);
  });

  test('stops the former instance only after the grace period', async () => {
    const instances = fakeSpawn();
    const timer = fakeSchedule();
    const state = new FreshMockState(instances.spawn, timer.schedule, 5_000);
    await state.fresh();
    await settle();
    assert.deepEqual(instances.stopped, []);
    assert.deepEqual(timer.delays, [5_000]);
    timer.run();
    assert.deepEqual(instances.stopped, [1]);
  });

  test('two fresh starts in a row give two different instances and stop both former ones', async () => {
    const instances = fakeSpawn();
    const timer = fakeSchedule();
    const state = new FreshMockState(instances.spawn, timer.schedule);
    const ports = await Promise.all([state.fresh(), state.fresh()]);
    assert.deepEqual(ports, [2, 3]);
    await settle();
    timer.run();
    assert.deepEqual(instances.stopped.sort(), [1, 2]);
  });

  test('a failed instance fails its test, and the next fresh start works again', async () => {
    // Instance 2 (the first spare) fails to start
    const instances = fakeSpawn([2]);
    const state = new FreshMockState(instances.spawn, fakeSchedule().schedule);
    await assert.rejects(state.fresh(), /instance 2 failed/);
    await assert.rejects(state.port());
    assert.equal(await state.fresh(), 3);
    assert.equal(await state.port(), 3);
  });

  test('closing stops the current instance and the spare', async () => {
    const instances = fakeSpawn();
    const state = new FreshMockState(instances.spawn, fakeSchedule().schedule);
    await state.close();
    assert.deepEqual(instances.stopped.sort(), [1, 2]);
  });
});
