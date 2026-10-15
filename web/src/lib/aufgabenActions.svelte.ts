import { tick } from 'svelte';
import { taskFocusReturn } from './aufgabenFocus';
import { sendApi } from './api';
import {
  TASK_ENDPOINT,
  aufgabenStore,
  applyTask,
  loadTasks,
  taskProblem,
} from './aufgabenStore.svelte';
import type { Task } from './types';
interface TaskActionState {
  busy: boolean;
  error: string | null;
  message: string | null;
  messageHref: string | null;
  undoTask: Task | null;
  completionNotice: string | null;
  deleteTarget: Task | null;
  deleteError: string | null;
}
export interface TaskActions {
  state: Readonly<TaskActionState>;
  openDelete: (task: Task) => void;
  closeDelete: () => void;
  reloadDelete: () => Promise<void>;
  showMessage: (text: string | null, href?: string) => void;
  clearError: () => void;
  taskAction: (
    task: Task,
    action: 'toggle' | 'reject' | 'delete',
    restoring?: boolean
  ) => Promise<void>;
  closeNotice: () => void;
}
export function createTaskActions(onfocus: () => void): TaskActions {
  const state = $state({
    busy: false,
    error: null as string | null,
    message: null as string | null,
    messageHref: null as string | null,
    undoTask: null as Task | null,
    completionNotice: null as string | null,
    deleteTarget: null as Task | null,
    deleteError: null as string | null,
  });
  async function taskAction(
    task: Task,
    action: 'toggle' | 'reject' | 'delete',
    restoring = false
  ): Promise<void> {
    if (state.busy) return;
    const restoreFocus = taskFocusReturn(task.id);
    if (action === 'toggle') {
      state.undoTask = null;
      state.completionNotice = null;
    }
    if (action === 'delete') state.deleteError = null;
    state.busy = true;
    state.error = null;
    state.message = null;
    state.messageHref = null;
    try {
      if (action === 'toggle') {
        const updated = await sendApi<Task>('PUT', `${TASK_ENDPOINT}/${task.id}`, {
          ...task,
          done: task.state !== 'erledigt',
        });
        applyTask(updated);
      } else if (action === 'reject')
        await sendApi('POST', `${TASK_ENDPOINT}/${task.id}/entscheidung`, {
          etag: task.etag,
          action: 'ablehnen',
        });
      else await sendApi('DELETE', `${TASK_ENDPOINT}/${task.id}`, undefined, { etag: task.etag });
      if (action === 'delete') {
        state.deleteTarget = null;
        if (state.undoTask?.id === task.id) {
          state.undoTask = null;
          state.completionNotice = null;
        }
      }
      const reloaded = action === 'toggle' || (await loadTasks());
      state.busy = false;
      await tick();
      restoreFocus();
      if (document.activeElement === document.body) onfocus();
      if (!reloaded) return;
      if (action === 'toggle') {
        state.undoTask = restoring
          ? null
          : (aufgabenStore.data?.tasks.find((item) => item.id === task.id) ?? null);
        state.completionNotice = restoring
          ? 'Änderung rückgängig gemacht.'
          : task.state === 'erledigt'
            ? 'Aufgabe wieder geöffnet.'
            : 'Aufgabe erledigt.';
      }
      state.message =
        action === 'delete'
          ? 'Aufgabe gelöscht.'
          : action === 'reject'
            ? 'Vorschlag abgelehnt.'
            : null;
    } catch (e) {
      if (action === 'delete') state.deleteError = taskProblem(e);
      else state.error = taskProblem(e);
    } finally {
      state.busy = false;
    }
  }
  function closeNotice(): void {
    state.undoTask = null;
    state.completionNotice = null;
    state.message = null;
    state.messageHref = null;
  }
  return {
    state,
    taskAction,
    closeNotice,
    openDelete(task) {
      if (!state.busy) {
        state.deleteError = null;
        state.deleteTarget = task;
      }
    },
    async reloadDelete() {
      if (state.busy || !state.deleteTarget) return;
      const id = state.deleteTarget.id;
      state.busy = true;
      try {
        if (await loadTasks()) {
          state.deleteTarget = aufgabenStore.data?.tasks.find((item) => item.id === id) ?? null;
          state.deleteError = null;
        } else
          state.deleteError =
            'Die Aufgabe konnte nicht neu geladen werden. Prüfe deine Internetverbindung und tippe noch einmal auf „Aktuelle Fassung laden“.';
      } finally {
        state.busy = false;
      }
    },
    closeDelete() {
      if (!state.busy) state.deleteTarget = null;
    },
    showMessage(text, href) {
      state.messageHref = href ?? null;
      state.message = text;
    },
    clearError() {
      state.error = null;
    },
  };
}
