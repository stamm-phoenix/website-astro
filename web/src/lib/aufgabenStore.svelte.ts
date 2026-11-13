import { ApiError, errorMessage, fetchApi } from './api';
import { createResource } from './resource.svelte';
import type { Task, TasksOverview } from '../../../api/lib/aufgaben-model';
import type { StaffProtokolleData } from './types/protokolle';
import type { TaskUser } from '../../../api/lib/aufgaben-model';
import { etagNewer } from '../../../api/lib/etag-version';

export const TASK_ENDPOINT = '/intern/pflege/aufgaben';
export const TASK_PRESENTATION_KEY = 'phoenix:task-presentation:v1';
const TASK_FALLBACK =
  'Die Aufgaben konnten nicht geladen oder gespeichert werden. Prüfe deine Internetverbindung und versuche es noch einmal.';

let mutation = 0;
/** The value of `mutation` when the running load started; later patches are newer than its answer. */
let startedAt = 0;
// Non-reactive request bookkeeping, never rendered.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const changedTasks = new Map<number, { revision: number; task: Task }>();

/** The answer of a load, with the tasks patched after the load started where they are newer. */
function withLocalChanges(data: TasksOverview): TasksOverview {
  for (const [id, change] of changedTasks) {
    if (change.revision <= startedAt) continue;
    const index = data.tasks.findIndex((task) => task.id === id);
    if (index >= 0 && etagNewer(change.task.etag, data.tasks[index].etag)) {
      data.tasks[index] = change.task;
    }
  }
  changedTasks.clear();
  return data;
}

const overview = createResource<TasksOverview>(TASK_ENDPOINT, {
  transform: withLocalChanges,
  loadError: TASK_FALLBACK,
});

const people = $state({
  users: [] as TaskUser[],
  usersLoading: true,
  usersUnavailable: false,
  usersConfigurationError: false,
  protocols: null as StaffProtokolleData | null,
  protocolError: null as string | null,
});

/** The tasks (loaded by `loadTasks`) with the people they can go to and the minutes they come from. */
export const aufgabenStore = {
  get data(): TasksOverview | null {
    return overview.state.data;
  },
  get loading(): boolean {
    return overview.state.loading;
  },
  get error(): string | null {
    return overview.state.error;
  },
  get users(): TaskUser[] {
    return people.users;
  },
  get usersLoading(): boolean {
    return people.usersLoading;
  },
  get usersUnavailable(): boolean {
    return people.usersUnavailable;
  },
  get usersConfigurationError(): boolean {
    return people.usersConfigurationError;
  },
  get protocols(): StaffProtokolleData | null {
    return people.protocols;
  },
  get protocolError(): string | null {
    return people.protocolError;
  },
};

export function taskProblem(error: unknown): string {
  return (error instanceof ApiError && error.fields?.form) || errorMessage(error, TASK_FALLBACK);
}

/**
 * Loads the tasks again; only the newest load sets the data, the error or the loading state.
 * Resolves to whether the data shown now is the answer of a load that succeeded.
 */
export async function loadTasks(): Promise<boolean> {
  startedAt = mutation;
  await overview.load({ force: true });
  return overview.state.error === null && overview.state.data !== null;
}
export async function loadTaskUsers(): Promise<void> {
  people.usersLoading = true;
  try {
    const result = await fetchApi<{
      users: TaskUser[];
      unavailable: boolean;
      configurationError?: boolean;
    }>(`${TASK_ENDPOINT}/benutzer`);
    people.users = result.users;
    people.usersUnavailable = result.unavailable;
    people.usersConfigurationError = result.configurationError ?? false;
  } catch {
    people.usersUnavailable = true;
    people.usersConfigurationError = false;
    people.users = [];
  } finally {
    people.usersLoading = false;
  }
}
export async function loadTaskProtocols(): Promise<void> {
  people.protocolError = null;
  try {
    people.protocols = await fetchApi<StaffProtokolleData>('/intern/pflege/protokolle');
  } catch (error) {
    people.protocolError = taskProblem(error);
  }
}

/** Patch only the task; an in-flight overview still supplies all unrelated changes. */
export function applyTask(task: Task): void {
  changedTasks.set(task.id, { revision: ++mutation, task });
  const data = overview.state.data;
  if (!data) return;
  data.tasks = data.tasks.map((item) => (item.id === task.id ? task : item));
}
