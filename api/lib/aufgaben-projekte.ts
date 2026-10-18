/** Projects are names on tasks; a project exists while at least one open or done task carries it. */
import type { Task, TaskProject } from './aufgaben-model';

/** Collapse whitespace so that pasted names and typed names land in the same project. */
export function projectTitle(title: string): string {
  return title.normalize('NFKC').replace(/\s+/g, ' ').trim();
}
/** Case-insensitive identity of a project, also used as the filter value. */
export function projectKey(title: string): string {
  return projectTitle(title).toLocaleLowerCase('de');
}
/** Derive the project list from the tasks, alphabetically with their task counts. */
export function taskProjects(tasks: readonly Pick<Task, 'project' | 'state'>[]): TaskProject[] {
  const projects = new Map<string, TaskProject>();
  for (const task of tasks) {
    if (!task.project || (task.state !== 'offen' && task.state !== 'erledigt')) continue;
    const key = projectKey(task.project);
    const project = projects.get(key) ?? { title: task.project, open: 0, done: 0 };
    if (task.state === 'offen') project.open++;
    else project.done++;
    projects.set(key, project);
  }
  return [...projects.values()].sort((a, b) => a.title.localeCompare(b.title, 'de'));
}
