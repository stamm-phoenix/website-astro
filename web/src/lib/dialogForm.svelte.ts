import { ApiError, errorMessage } from './api';

export interface DialogFormState {
  busy: boolean;
  /** Shown above the dialog buttons. */
  error: string | null;
  /** Messages per form field, from the form's own checks or from the API. */
  fields: Record<string, string>;
  /** The item was changed elsewhere since it was loaded (409/412). */
  conflict: boolean;
}

export interface DialogForm {
  readonly state: DialogFormState;
  /** Clears all messages, e.g. when the dialog opens. */
  reset(): void;
  /** Replaces all messages with the form's own field messages; returns whether there were any. */
  invalid(fields: Record<string, string>): boolean;
  clearField(field: string): void;
  /** Shows the failure of a request that ran beside the form, e.g. a photo upload. */
  fail(error: unknown, fallback: string): void;
  /**
   * Runs a save or delete request while `busy` is set. Returns whether it succeeded; on failure
   * the API message, its field messages and a conflict end up in `state`.
   */
  run(work: () => Promise<void>, fallback: string): Promise<boolean>;
}

export const CONFLICT_MESSAGE =
  'Der Eintrag wurde inzwischen geändert. Deine Eingaben bleiben erhalten. Lade die aktuelle Fassung, um sie zu übernehmen.';

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && [409, 412].includes(error.status);
}

/** A conflict asks to load the current version; other failures show the API message. */
export function dialogMessage(error: unknown, fallback: string): string {
  return isConflict(error) ? CONFLICT_MESSAGE : errorMessage(error, fallback);
}

/**
 * State of an edit dialog shared by the modules of the Leitendenbereich. `message` turns a
 * failure into the text shown.
 */
export function createDialogForm(
  message: (error: unknown, fallback: string) => string = dialogMessage
): DialogForm {
  const state = $state<DialogFormState>({ busy: false, error: null, fields: {}, conflict: false });

  function reset(): void {
    state.error = null;
    state.fields = {};
    state.conflict = false;
  }

  function fail(error: unknown, fallback: string): void {
    state.conflict = isConflict(error);
    state.error = message(error, fallback);
  }

  return {
    state,
    reset,
    fail,
    invalid(fields) {
      // A message from an earlier request no longer applies to this attempt
      reset();
      state.fields = fields;
      return Object.keys(fields).length > 0;
    },
    clearField(field) {
      delete state.fields[field];
      if (!state.conflict && !Object.keys(state.fields).length) state.error = null;
    },
    async run(work, fallback) {
      if (state.busy) return false;
      state.busy = true;
      reset();
      try {
        await work();
        return true;
      } catch (error) {
        fail(error, fallback);
        state.fields = error instanceof ApiError ? (error.fields ?? {}) : {};
        return false;
      } finally {
        state.busy = false;
      }
    },
  };
}
