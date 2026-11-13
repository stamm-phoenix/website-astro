import { errorMessage } from './api';
import type { DialogForm } from './dialogForm.svelte';
import type { NoticeKind } from './status';

/** What a list reloads after an action: a `createResource` store. */
export interface Reloadable {
  load: (options: { force: true }) => Promise<void>;
}

export interface ActionOptions<T> {
  /** Shown when the request fails and the API has no message of its own (`errorMessage`). */
  fallback: string;
  /** Result shown as a notice once `work` succeeded; a function gets what `work` returned. */
  success?: string | ((value: T) => string);
  /** Loaded again after the notice, so the list shows the new state; a failure skips it. */
  reload?: Reloadable;
  /**
   * A message of the module's own for a failure, e.g. for a conflict (the function may reload
   * first); `null` leaves it to `errorMessage`.
   */
  failure?: (error: unknown) => string | null | Promise<string | null>;
  /** Where the failure text goes instead of the notice, e.g. the error line of a dialog. */
  fail?: (text: string, error: unknown) => void;
  /**
   * Runs the action as `form.run` of an edit dialog: its busy state, error line, field messages
   * and conflict handling apply, and `failure` and `fail` are not used.
   */
  form?: DialogForm;
}

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export interface ActionRunner {
  /** An action is running: disables the buttons of the list. */
  readonly busy: boolean;
  /** The result of the last action, for `StatusNotice`; `null` before the first one. */
  readonly message: string | null;
  readonly kind: NoticeKind;
  /** Shows a result that does not come from `run`, e.g. a person that vanished meanwhile. */
  show: (text: string, kind?: NoticeKind) => void;
  clear: () => void;
  /**
   * Runs a request of a list or its dialog: busy while it runs, the success notice after it,
   * then the reload; a failure shows `errorMessage(error, fallback)` and leaves the list as it
   * was. Does not stop a second call: disable the buttons with `busy`.
   */
  run: <T>(work: () => Promise<T>, options: ActionOptions<T>) => Promise<ActionResult<T>>;
}

/**
 * The state every module with a list and an edit dialog keeps: the notice of the last action
 * and whether one is running.
 */
export function createActionRunner(): ActionRunner {
  const state = $state({
    running: 0,
    message: null as string | null,
    kind: 'success' as NoticeKind,
  });

  function show(text: string, kind: NoticeKind = 'success'): void {
    state.message = text;
    state.kind = kind;
  }

  async function succeed<T>(value: T, options: ActionOptions<T>): Promise<void> {
    const { success, reload } = options;
    if (success !== undefined) show(typeof success === 'function' ? success(value) : success);
    await reload?.load({ force: true });
  }

  async function run<T>(
    work: () => Promise<T>,
    options: ActionOptions<T>
  ): Promise<ActionResult<T>> {
    state.running++;
    try {
      if (options.form) {
        let value: T | undefined;
        const ok = await options.form.run(async () => {
          value = await work();
          await succeed(value, options);
        }, options.fallback);
        return ok
          ? { ok: true, value: value as T }
          : { ok: false, error: options.form.state.error };
      }
      try {
        const value = await work();
        await succeed(value, options);
        return { ok: true, value };
      } catch (error: unknown) {
        const text = (await options.failure?.(error)) ?? errorMessage(error, options.fallback);
        if (options.fail) options.fail(text, error);
        else show(text, 'error');
        return { ok: false, error };
      }
    } finally {
      state.running--;
    }
  }

  return {
    get busy() {
      return state.running > 0;
    },
    get message() {
      return state.message;
    },
    get kind() {
      return state.kind;
    },
    show,
    clear() {
      state.message = null;
    },
    run,
  };
}
