import { ApiError } from './api';
import { loadTasks, taskProblem } from './aufgabenStore.svelte';
/** Each mounted editor owns its form state; no shared drafts survive route/dialog changes. */
interface TaskForm {
  state: { busy: boolean; error: string | null; fields: Record<string, string> };
  submit: (work: () => Promise<string>, onsaved: (message: string) => void) => Promise<void>;
}
export function createTaskForm(): TaskForm {
  const state = $state({
    busy: false,
    error: null as string | null,
    fields: {} as Record<string, string>,
  });
  async function submit(
    work: () => Promise<string>,
    onsaved: (message: string) => void
  ): Promise<void> {
    if (state.busy) return;
    state.busy = true;
    state.error = null;
    state.fields = {};
    try {
      const message = await work();
      await loadTasks();
      onsaved(message);
    } catch (error) {
      state.error = taskProblem(error);
      state.fields = error instanceof ApiError ? (error.fields ?? {}) : {};
    } finally {
      state.busy = false;
    }
  }
  return { state, submit };
}
