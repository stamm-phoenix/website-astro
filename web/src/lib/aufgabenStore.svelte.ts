import { ApiError, errorMessage, fetchApi } from './api';
import type { Task, TasksOverview, StaffProtokolleData } from './types';
import type { SharePointSiteUser } from '../../../api/lib/sharepoint-types';

export const TASK_ENDPOINT = '/intern/pflege/aufgaben';
export const TASK_PRESENTATION_KEY = 'phoenix:task-presentation:v1';
export const aufgabenStore = $state({
  data: null as TasksOverview | null,
  loading: true,
  error: null as string | null,
  users: [] as SharePointSiteUser[],
  usersLoading: true,
  usersUnavailable: false,
  usersConfigurationError: false,
  protocols: null as StaffProtokolleData | null,
  protocolError: null as string | null,
});
let request = 0;
let mutation = 0;
// Non-reactive request bookkeeping, never rendered.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const changedTasks = new Map<number, { revision: number; task: Task }>();
export function taskProblem(error: unknown): string {
  return (
    (error instanceof ApiError && error.fields?.form) ||
    errorMessage(
      error,
      'Die Aufgaben konnten nicht geladen oder gespeichert werden. Prüfe deine Internetverbindung und versuche es noch einmal.'
    )
  );
}
/** Only the latest refresh may replace data, errors or loading state. */
export async function loadTasks(): Promise<boolean> {
  const sequence = ++request;
  const startedAt = mutation;
  aufgabenStore.loading = true;
  aufgabenStore.error = null;
  try {
    const data = await fetchApi<TasksOverview>(TASK_ENDPOINT);
    if (sequence !== request) return false;
    for (const [id, change] of changedTasks) {
      if (change.revision <= startedAt) continue;
      const index = data.tasks.findIndex((task) => task.id === id);
      if (
        index >= 0 &&
        /^"[0-9a-f]{16}"$/.test(change.task.etag) &&
        /^"[0-9a-f]{16}"$/.test(data.tasks[index].etag) &&
        change.task.etag > data.tasks[index].etag
      )
        data.tasks[index] = change.task;
    }
    changedTasks.clear();
    aufgabenStore.data = data;
    return true;
  } catch (error) {
    if (sequence === request) aufgabenStore.error = taskProblem(error);
    return false;
  } finally {
    if (sequence === request) aufgabenStore.loading = false;
  }
}
export async function loadTaskUsers(): Promise<void> {
  aufgabenStore.usersLoading = true;
  try {
    const result = await fetchApi<{
      users: SharePointSiteUser[];
      unavailable: boolean;
      configurationError?: boolean;
    }>(`${TASK_ENDPOINT}/benutzer`);
    aufgabenStore.users = result.users;
    aufgabenStore.usersUnavailable = result.unavailable;
    aufgabenStore.usersConfigurationError = result.configurationError ?? false;
  } catch {
    aufgabenStore.usersUnavailable = true;
    aufgabenStore.usersConfigurationError = false;
    aufgabenStore.users = [];
  } finally {
    aufgabenStore.usersLoading = false;
  }
}
export async function loadTaskProtocols(): Promise<void> {
  aufgabenStore.protocolError = null;
  try {
    aufgabenStore.protocols = await fetchApi<StaffProtokolleData>('/intern/pflege/protokolle');
  } catch (error) {
    aufgabenStore.protocolError = taskProblem(error);
  }
}

/** Patch only the task; an in-flight overview still supplies all unrelated changes. */
export function applyTask(task: Task): void {
  changedTasks.set(task.id, { revision: ++mutation, task });
  if (!aufgabenStore.data) return;
  aufgabenStore.data.tasks = aufgabenStore.data.tasks.map((item) =>
    item.id === task.id ? task : item
  );
}
