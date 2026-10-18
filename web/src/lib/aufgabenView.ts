import type { Task } from './types';
import { taskHasAssignee } from '../../../api/lib/aufgaben-zuordnung';
import { projectKey } from '../../../api/lib/aufgaben-projekte';
export { taskProjects } from '../../../api/lib/aufgaben-projekte';
export { berlinDay as taskToday } from '../../../api/lib/calendar-day';
import { berlinDay as taskToday } from '../../../api/lib/calendar-day';
export interface TaskFilters {
  /** `alle`, empty for „Ohne Projekt“, or `projectFilterValue` of a project. */
  project: string;
  own: boolean;
  login?: string;
}
export function matchesTaskFilters(task: Task, filters: TaskFilters): boolean {
  return (
    (filters.project === 'alle' ||
      (task.project ? projectFilterValue(task.project) : '') === filters.project) &&
    (!filters.own || taskHasAssignee(task, filters.login))
  );
}
/** Prefixed so that a project named „alle“ cannot collide with the other filter values. */
export function projectFilterValue(title: string): string {
  return `projekt:${projectKey(title)}`;
}
export function pendingTask(task: Task): boolean {
  return task.state === 'vorschlag' && (!task.dueDate || task.dueDate >= taskToday());
}
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      a.title.localeCompare(b.title, 'de')
  );
}
export function protocolLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat('de-DE', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(parsed);
}
export function dueLabel(task: Task): string {
  if (!task.dueDate) return 'Ohne Frist';
  const today = taskToday();
  if (task.state === 'offen' && task.dueDate < today) {
    const days = Math.round(
      (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${task.dueDate}T12:00:00Z`)) / 86400000
    );
    return `Fällig: ${days} ${days === 1 ? 'Tag' : 'Tage'} überfällig`;
  }
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const label =
    task.dueDate === today
      ? 'Heute'
      : task.dueDate === tomorrow.toISOString().slice(0, 10)
        ? 'Morgen'
        : new Intl.DateTimeFormat('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(`${task.dueDate}T12:00:00Z`));
  return `Fällig: ${label}`;
}
export function dueSoon(task: Task): boolean {
  if (task.state !== 'offen' || !task.dueDate) return false;
  const today = taskToday();
  const horizon = new Date(`${today}T12:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 3);
  return task.dueDate <= horizon.toISOString().slice(0, 10);
}
