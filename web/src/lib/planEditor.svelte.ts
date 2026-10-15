import { ApiError, errorMessage } from './api';
import { confirmAction } from './confirm';
import { guardUnsavedChanges } from './unsavedChanges';

interface Notice {
  text: string;
  kind: 'success' | 'warning' | 'error';
}

interface PlanEditorOptions {
  dirty: () => boolean;
  conflictMessage: string;
  saveError: string;
  field: string;
}

interface PlanEditor {
  state: { saving: boolean; conflict: boolean; notice: Notice | null };
  save: (write: () => Promise<void>, success: string) => Promise<void>;
  confirmReload: (message: string) => Promise<boolean>;
}

/** Shared save/conflict feedback and leave protection; each plan keeps its own draft. */
export function createPlanEditor(options: PlanEditorOptions): PlanEditor {
  const state = $state({
    saving: false,
    conflict: false,
    notice: null as Notice | null,
  });
  $effect(() => guardUnsavedChanges(options.dirty));

  async function save(write: () => Promise<void>, success: string): Promise<void> {
    state.saving = true;
    state.notice = null;
    try {
      await write();
      state.notice = { text: success, kind: 'success' };
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) {
        state.conflict = true;
        state.notice = { text: options.conflictMessage, kind: 'error' };
      } else {
        state.notice = {
          text:
            (error instanceof ApiError && error.fields?.[options.field]) ||
            errorMessage(error, options.saveError),
          kind: 'error',
        };
      }
    } finally {
      state.saving = false;
    }
  }

  async function confirmReload(message: string): Promise<boolean> {
    if (
      options.dirty() &&
      !(await confirmAction({
        title: 'Neu laden?',
        message,
        confirmLabel: 'Neu laden',
      }))
    )
      return false;
    state.notice = null;
    return true;
  }

  return { state, save, confirmReload };
}
