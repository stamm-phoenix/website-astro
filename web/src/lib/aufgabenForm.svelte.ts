import { ApiError } from './api';
import { loadTasks, taskProblem } from './aufgabenStore.svelte';
/** Each mounted editor owns its form state; no shared drafts survive route/dialog changes. */
interface TaskForm {
  state: { busy: boolean; error: string | null; fields: Record<string, string>; conflict: boolean };
  clearField: (field: string) => void;
  changed: (event: Event) => void;
  reload: (reset: () => void) => Promise<boolean>;
  submit: (
    work: () => Promise<string>,
    onsaved: (message: string) => void,
    reload?: boolean
  ) => Promise<void>;
}
export function createTaskForm(): TaskForm {
  const state = $state({
    busy: false,
    conflict: false,
    error: null as string | null,
    fields: {} as Record<string, string>,
  });
  async function submit(
    work: () => Promise<string>,
    onsaved: (message: string) => void,
    reload = true
  ): Promise<void> {
    if (state.busy) return;
    state.busy = true;
    state.error = null;
    state.conflict = false;
    state.fields = {};
    try {
      const message = await work();
      const refreshed = !reload || (await loadTasks());
      onsaved(
        refreshed
          ? message
          : 'Gespeichert. Die Ansicht konnte nicht aktualisiert werden. Bitte neu laden.'
      );
    } catch (error) {
      state.error = taskProblem(error);
      state.conflict = error instanceof ApiError && [409, 412].includes(error.status);
      state.fields = error instanceof ApiError ? (error.fields ?? {}) : {};
    } finally {
      state.busy = false;
    }
  }
  function clearField(field: string): void {
    delete state.fields[field];
    if (!state.conflict && !Object.keys(state.fields).length) state.error = null;
  }
  return {
    state,
    submit,
    clearField,
    changed(event) {
      const id = event.target instanceof HTMLElement ? event.target.id : '';
      const fields: Record<string, string> = {
        'task-title': 'title',
        'task-description': 'description',
        'task-assignee': 'assignee',
        'task-due': 'dueDate',
        'task-project': 'projectId',
        'project-event': 'campflowId',
        'checklist-template': 'templateId',
        'checklist-date': 'dueDate',
        'suggested-project-title': 'newProjectTitle',
      };
      if (fields[id]) clearField(fields[id]);
      if (id.startsWith('template-')) clearField('items');
    },
    async reload(reset) {
      if (state.busy) return false;
      state.busy = true;
      const loaded = await loadTasks();
      if (loaded) {
        reset();
        state.error = null;
        state.fields = {};
        state.conflict = false;
      } else
        state.error =
          'Die aktuelle Fassung konnte nicht geladen werden. Deine Eingaben bleiben erhalten. Bitte erneut versuchen.';
      state.busy = false;
      return loaded;
    },
  };
}
