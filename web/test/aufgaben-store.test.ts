import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { applyTask, aufgabenStore, loadTasks } from '../src/lib/aufgabenStore.svelte';
import type { Task, TasksOverview } from '../../api/lib/aufgaben-model';
import { gate, json, stubFetch } from './fixtures/fetch-stub';

/** Tasks changed while the overview loads must survive when they are newer than its answer. */

let stub: ReturnType<typeof stubFetch> | null = null;
afterEach(() => stub?.restore());

const hex = (n: number): string => `"${n.toString(16).padStart(16, '0')}"`;

function task(id: number, version: number, title = `Aufgabe ${id}`): Task {
  return { id, etag: hex(version), title } as unknown as Task;
}

function overview(...tasks: Task[]): TasksOverview {
  return { tasks, projects: [], templates: [], login: '', extractionConfigured: false };
}

function titles(): string[] {
  return (aufgabenStore.data?.tasks ?? []).map((item) => item.title);
}

test('an answer that started before a save keeps the saved task when that is newer', async () => {
  const offen = gate();
  stub = stubFetch(async () => {
    await offen.promise;
    return json(overview(task(1, 0xa, 'alt'), task(2, 0xb, 'unverändert')));
  });
  const load = loadTasks();
  applyTask(task(1, 0xc, 'gespeichert'));
  offen.open();
  assert.equal(await load, true);
  assert.deepEqual(titles(), ['gespeichert', 'unverändert']);
});

test('the answer wins where its task is the newer version', async () => {
  stub = stubFetch(async () => json(overview(task(1, 0x100, 'Server'), task(2, 0x9, 'Server'))));
  const load = loadTasks();
  applyTask(task(1, 0xff, 'lokal alt'));
  applyTask(task(2, 0x10, 'lokal neu'));
  await load;
  assert.deepEqual(titles(), ['Server', 'lokal neu']);
});

test('a patch made before the load started is not applied again to its answer', async () => {
  stub = stubFetch(async () => json(overview(task(5, 1, 'Server'))));
  await loadTasks();
  applyTask(task(5, 2, 'lokal'));
  assert.deepEqual(titles(), ['lokal']);
  stub.restore();
  stub = stubFetch(async () => json(overview(task(5, 1, 'älterer Stand'))));
  await loadTasks();
  assert.deepEqual(titles(), ['älterer Stand']);
});

test('a failed load reports the problem, keeps the tasks and resolves to false', async () => {
  stub = stubFetch(async () => json(overview(task(7, 1))));
  await loadTasks();
  stub.restore();
  stub = stubFetch(async () => json({ message: 'Kaputt' }, 500));
  assert.equal(await loadTasks(), false);
  assert.equal(aufgabenStore.loading, false);
  assert.ok(aufgabenStore.error);
  assert.equal(aufgabenStore.data?.tasks.length, 1);
});

test('only the newest of two loads sets the tasks', async () => {
  const alt = gate();
  let calls = 0;
  stub = stubFetch(async () => {
    if (++calls === 1) {
      await alt.promise;
      return json(overview(task(1, 1, 'alt')));
    }
    return json(overview(task(1, 2, 'neu')));
  });
  const first = loadTasks();
  const second = loadTasks();
  assert.equal(await second, true);
  alt.open();
  await first;
  assert.deepEqual(titles(), ['neu']);
  assert.equal(aufgabenStore.loading, false);
});
