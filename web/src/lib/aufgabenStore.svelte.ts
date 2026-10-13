import { ApiError, fetchApi } from './api';
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
  protocols: null as StaffProtokolleData | null,
  protocolError: null as string | null,
});
let request = 0;
export function taskProblem(error: unknown): string {
  return error instanceof ApiError
    ? (error.fields?.form ?? error.message)
    : 'Die Daten konnten nicht geladen oder gespeichert werden.';
}
/** Only the latest refresh may replace data, errors or loading state. */
export async function loadTasks(): Promise<boolean> {
  const sequence = ++request;
  aufgabenStore.loading = true;
  aufgabenStore.error = null;
  try {
    const data = await fetchApi<TasksOverview>(TASK_ENDPOINT);
    if (sequence !== request) return false;
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
    const result = await fetchApi<{ users: SharePointSiteUser[]; unavailable: boolean }>(
      `${TASK_ENDPOINT}/benutzer`
    );
    aufgabenStore.users = result.users;
    aufgabenStore.usersUnavailable = result.unavailable;
  } catch {
    aufgabenStore.usersUnavailable = true;
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

/** A mutation response supersedes any overview request started before it. */
export function applyTask(task: Task): void {
  request++;
  aufgabenStore.loading = false;
  aufgabenStore.error = null;
  if (!aufgabenStore.data) return;
  aufgabenStore.data.tasks = aufgabenStore.data.tasks.map((item) =>
    item.id === task.id ? task : item
  );
}
