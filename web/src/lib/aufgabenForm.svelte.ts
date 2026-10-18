import { createDialogForm } from './dialogForm.svelte';
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
  const form = createDialogForm((error) => taskProblem(error));
  const { state } = form;
  async function submit(
    work: () => Promise<string>,
    onsaved: (message: string) => void,
    reload = true
  ): Promise<void> {
    await form.run(async () => {
      const message = await work();
      const refreshed = !reload || (await loadTasks());
      onsaved(
        refreshed
          ? message
          : 'Gespeichert. Die Liste zeigt noch den alten Stand. Lade die Seite neu.'
      );
    }, '');
  }
  const clearField = form.clearField;
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
        'task-project': 'project',
        'checklist-project': 'project',
        'project-title': 'title',
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
        form.reset();
      } else
        state.error =
          'Die aktuelle Fassung konnte nicht geladen werden. Deine Eingaben sind noch da. Prüfe deine Internetverbindung und tippe noch einmal auf „Neu laden“.';
      state.busy = false;
      return loaded;
    },
  };
}
