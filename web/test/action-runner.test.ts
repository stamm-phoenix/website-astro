import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActionRunner } from '../src/lib/actionRunner.svelte';
import { ApiError } from '../src/lib/api';
import { createDialogForm } from '../src/lib/dialogForm.svelte';

function reloader(log: string[]): { load: (options: { force: true }) => Promise<void> } {
  return {
    load: async (options) => {
      log.push(`load force=${options.force}`);
    },
  };
}

test('an action is busy while it runs, shows its success and reloads the list afterwards', async () => {
  const log: string[] = [];
  const runner = createActionRunner();
  let release!: () => void;
  const running = runner.run(
    async () => {
      log.push('work');
      await new Promise<void>((resolve) => (release = resolve));
      return 'Beleg';
    },
    {
      fallback: 'nicht gespeichert',
      success: (name) => `${name} gespeichert.`,
      reload: {
        load: async () => {
          log.push(`reload after "${runner.message}"`);
        },
      },
    }
  );
  assert.equal(runner.busy, true);
  assert.equal(runner.message, null);
  release();
  const result = await running;
  assert.deepEqual(result, { ok: true, value: 'Beleg' });
  assert.equal(runner.busy, false);
  assert.equal(runner.message, 'Beleg gespeichert.');
  assert.equal(runner.kind, 'success');
  assert.deepEqual(log, ['work', 'reload after "Beleg gespeichert."']);
});

test('a failure shows the API message, or the fallback with the help contact, and does not reload', async () => {
  const log: string[] = [];
  const runner = createActionRunner();
  const reload = reloader(log);
  const own = await runner.run(
    async () => {
      throw new ApiError(400, 'Der Name fehlt.');
    },
    { fallback: 'Nicht gespeichert.', success: 'Gespeichert.', reload }
  );
  assert.equal(own.ok, false);
  assert.equal(runner.message, 'Der Name fehlt.');
  assert.equal(runner.kind, 'error');
  await runner.run(
    async () => {
      throw new Error('offline');
    },
    { fallback: 'Nicht gespeichert.', reload }
  );
  assert.equal(runner.message, 'Nicht gespeichert.');
  assert.equal(runner.busy, false);
  assert.deepEqual(log, []);
});

test('a message of the module replaces the default, and may reload first', async () => {
  const log: string[] = [];
  const runner = createActionRunner();
  await runner.run(
    async () => {
      throw new ApiError(409, 'x', { code: 'CONFLICT' });
    },
    {
      fallback: 'Nicht gelöscht.',
      failure: async (error) => {
        if (!(error instanceof ApiError) || error.code !== 'CONFLICT') return null;
        await reloader(log).load({ force: true });
        return 'Jemand anderes war schneller.';
      },
    }
  );
  assert.equal(runner.message, 'Jemand anderes war schneller.');
  assert.deepEqual(log, ['load force=true']);
});

test('a failure can go to another place than the notice', async () => {
  const runner = createActionRunner();
  let line: string | null = null;
  await runner.run(
    async () => {
      throw new Error('offline');
    },
    {
      fallback: 'Die Änderung wurde nicht gespeichert.',
      fail: (text) => (line = text),
    }
  );
  assert.equal(line, 'Die Änderung wurde nicht gespeichert.');
  assert.equal(runner.message, null);
});

test('busy stays on until the last of two overlapping actions is done', async () => {
  const runner = createActionRunner();
  let first!: () => void;
  const a = runner.run(() => new Promise<void>((resolve) => (first = resolve)), { fallback: '' });
  const b = runner.run(async () => undefined, { fallback: '' });
  await b;
  assert.equal(runner.busy, true);
  first();
  await a;
  assert.equal(runner.busy, false);
});

test('show and clear set and remove a notice without an action', () => {
  const runner = createActionRunner();
  runner.show('Die Person wurde inzwischen gelöscht.', 'warning');
  assert.equal(runner.message, 'Die Person wurde inzwischen gelöscht.');
  assert.equal(runner.kind, 'warning');
  runner.clear();
  assert.equal(runner.message, null);
});

test('with a dialog form, the dialog shows busy and the failure, and the list still reloads', async () => {
  const log: string[] = [];
  const runner = createActionRunner();
  const form = createDialogForm();
  const saved = await runner.run(async () => 7, {
    form,
    fallback: 'Nicht gespeichert.',
    success: 'Gespeichert.',
    reload: reloader(log),
  });
  assert.deepEqual(saved, { ok: true, value: 7 });
  assert.equal(runner.message, 'Gespeichert.');
  assert.deepEqual(log, ['load force=true']);

  const failed = await runner.run(
    async () => {
      throw new ApiError(412, 'alt');
    },
    { form, fallback: 'Nicht gespeichert.', success: 'Nie gezeigt.', reload: reloader(log) }
  );
  assert.equal(failed.ok, false);
  assert.equal(form.state.conflict, true);
  assert.equal(form.state.busy, false);
  assert.equal(runner.message, 'Gespeichert.');
  assert.deepEqual(log, ['load force=true']);
});
