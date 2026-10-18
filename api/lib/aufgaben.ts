import { taskPeople, taskAssigneeLogin } from './aufgaben-zuordnung';
import { createHash } from 'node:crypto';
import type { Selectable, Transaction } from 'kysely';
import type { Database, TaskTable } from './db-schema';
import type { Task, TaskInput, TaskProject, TaskTemplate, TemplateItem } from './aufgaben-model';
import { projectKey, projectTitle, taskProjects } from './aufgaben-projekte';
import {
  getDb,
  inTransaction,
  lockResource,
  requireVersion,
  toDateString,
  toVersion,
  VersionConflictError,
} from './db';
import { ValidationError } from './pflege-validation';
import { validateTemplate } from './aufgaben-validation';

/** Serialize SQL dates and rowversions for browser consumers. */
function toTask(row: Selectable<TaskTable>): Task {
  return {
    id: row.id,
    etag: toVersion(row.version),
    title: row.title,
    description: row.description,
    assignee: row.assignee,
    assignees: taskPeople({
      assignee: row.assignee,
      ...(row.assignees !== '[]' ? { assignees: JSON.parse(row.assignees) } : {}),
    }),
    dueDate: row.due_date ? toDateString(row.due_date) : null,
    project: row.project,
    suggestedProjectTitle: row.suggested_project_title,
    suggestedAssigneeName: row.suggested_assignee_name,
    assignmentResolution: row.assignment_resolution,
    state: row.state,
    sourceId: row.source_id,
    sourceVersion: row.source_version,
    quote: row.quote,
  };
}
/** Load tasks including proposal decisions, without consulting SharePoint. */
export async function getTasks(filter?: {
  dueDates: readonly string[];
  state: 'offen';
}): Promise<Task[]> {
  let query = getDb().selectFrom('organisation.task').selectAll();
  if (filter)
    query = query.where('state', '=', filter.state).where('due_date', 'in', filter.dueDates);
  return (await query.orderBy('id').execute()).map(toTask);
}
/** Load one task with its current ETag, or return undefined when absent. */
export async function getTask(id: number): Promise<Task | undefined> {
  const row = await getDb()
    .selectFrom('organisation.task')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toTask(row) : undefined;
}
/** Projects that currently exist, i.e. carried by at least one open or done task. */
export async function getTaskProjects(): Promise<TaskProject[]> {
  return taskProjects(
    await getDb()
      .selectFrom('organisation.task')
      .select(['project', 'state'])
      .where('project', '<>', '')
      .where('state', 'in', ['offen', 'erledigt'])
      .execute()
  );
}
/** Read and validate the stored JSON checklist definitions. */
export async function getTaskTemplates(): Promise<TaskTemplate[]> {
  return (
    await getDb().selectFrom('organisation.template').selectAll().orderBy('title').execute()
  ).map((row) => ({
    id: row.id,
    etag: toVersion(row.version),
    ...validateTemplate({ title: row.title, items: JSON.parse(row.items) as unknown }),
  }));
}
/** Rename a project by renaming it on all its tasks; the same name merges both projects. */
export async function renameTaskProject(from: string, to: string, actor: string): Promise<number> {
  return inTransaction(async (trx) => {
    const title = await canonicalProject(trx, to, from);
    const changed = await trx
      .updateTable('organisation.task')
      .set({ project: title, updated_by: actor })
      .where('project', '=', projectTitle(from))
      .output('inserted.id')
      .execute();
    return changed.length;
  });
}
/** Create a reusable checklist or conditionally update its definition. */
export async function saveTaskTemplate(
  input: { title: string; items: TemplateItem[] },
  actor: string,
  id?: number,
  etag?: string
): Promise<void> {
  const values = { title: input.title, items: JSON.stringify(input.items), updated_by: actor };
  if (id === undefined) {
    await getDb().insertInto('organisation.template').values(values).execute();
  } else {
    const changed = await getDb()
      .updateTable('organisation.template')
      .set(values)
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .output('inserted.id')
      .executeTakeFirst();
    if (!changed) throw new VersionConflictError();
  }
}
/** Map validated task fields to SQL columns and record the acting login. */
function columns(input: TaskInput, actor: string) {
  const people = taskPeople(input);
  return {
    title: input.title,
    description: input.description,
    assignee: people[0]?.login || people[0]?.name || '',
    assignees: JSON.stringify(people),
    due_date: input.dueDate,
    ...(input.project !== undefined ? { project: input.project } : {}),
    updated_by: actor,
  };
}
/**
 * Spell a project like the tasks that already carry it, so that „herbstlager“ joins
 * „Herbstlager“. `except` is a project name whose own spelling must not be reused (renaming).
 */
async function canonicalProject(
  trx: Transaction<Database>,
  title: string,
  except = ''
): Promise<string> {
  const wanted = projectTitle(title);
  if (!wanted) return '';
  const existing = await trx
    .selectFrom('organisation.task')
    .select('project')
    .distinct()
    .where('project', '=', wanted)
    .execute();
  return (
    existing.find(
      (row) =>
        projectKey(row.project) === projectKey(wanted) &&
        projectKey(row.project) !== projectKey(except)
    )?.project ?? wanted
  );
}
async function withProject(input: TaskInput, trx: Transaction<Database>): Promise<TaskInput> {
  return input.project === undefined
    ? input
    : { ...input, project: await canonicalProject(trx, input.project) };
}
/** Create an open task; its project exists from now on if it did not already. */
export async function createTask(input: TaskInput, actor: string): Promise<void> {
  await inTransaction(async (trx) => {
    await trx
      .insertInto('organisation.task')
      .values({ ...columns(await withProject(input, trx), actor), state: 'offen' })
      .execute();
  });
}
/** Older clients editing an unchanged first assignee must not discard the other people. */
async function preserveLegacyPeople(id: number, input: TaskInput): Promise<TaskInput> {
  if (input.assignees !== undefined) return input;
  const current = await getTask(id);
  return current && taskAssigneeLogin(current.assignee) === taskAssigneeLogin(input.assignee)
    ? { ...input, assignees: current.assignees }
    : input;
}
/** Ordinary edits cannot accept or revive suggestions; they use the review endpoint. */
export async function updateTask(
  id: number,
  input: TaskInput,
  done: boolean,
  etag: string | undefined,
  actor: string
): Promise<Task> {
  input = await preserveLegacyPeople(id, input);
  return inTransaction(async (trx) => {
    const result = await trx
      .updateTable('organisation.task')
      .set({
        ...columns(await withProject(input, trx), actor),
        state: done ? 'erledigt' : 'offen',
      })
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .where('state', 'in', ['offen', 'erledigt'])
      .outputAll('inserted')
      .executeTakeFirst();
    if (!result) throw new VersionConflictError();
    return toTask(result);
  });
}
/** Delete manual tasks conditionally; source decisions must remain to prevent re-extraction. */
export async function deleteTask(id: number, etag: string | undefined): Promise<void> {
  // Source rows remain as decision records to prevent repeated extraction recreating tasks.
  const task = await getTask(id);
  if (task && task.etag === etag && task.sourceId)
    throw new ValidationError({
      form: 'Aufgaben aus Protokollen werden erledigt, nicht gelöscht.',
    });
  const result = await getDb()
    .deleteFrom('organisation.task')
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .where('source_id', '=', '')
    .output('deleted.id')
    .executeTakeFirst();
  if (!result) throw new VersionConflictError();
}
/** Compute a UTC-relative deadline and reject dates outside the SQL date range. */
export function templateDate(date: string, daysBefore: number): string {
  const due = new Date(`${date}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() - daysBefore);
  const result = due.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result.startsWith('0000-'))
    throw new ValidationError({
      dueDate: 'Die berechnete Frist liegt außerhalb des gültigen Datumsbereichs.',
    });
  return result;
}
/** Atomic and idempotent per project/template while tasks from the template remain in the project. */
export async function applyTaskTemplate(
  project: string,
  templateId: number,
  date: string,
  etag: string | undefined,
  actor: string
): Promise<number> {
  return inTransaction(async (trx) => {
    const title = await canonicalProject(trx, project);
    const key = createHash('sha256').update(projectKey(title)).digest('hex');
    await lockResource(trx, `checklist:${key}:${templateId}`);
    const template = await trx
      .selectFrom('organisation.template')
      .selectAll()
      .where('id', '=', templateId)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (!template) throw new VersionConflictError();
    const applied = await trx
      .selectFrom('organisation.task')
      .select('id')
      .where('project', '=', title)
      .where('checklist_template_id', '=', templateId)
      .where('state', 'in', ['offen', 'erledigt'])
      .executeTakeFirst();
    if (applied) return 0;
    const { items } = validateTemplate({
      title: template.title,
      items: JSON.parse(template.items) as unknown,
    });
    for (const item of items) {
      await trx
        .insertInto('organisation.task')
        .values({
          ...columns(
            { ...item, project: title, dueDate: templateDate(date, item.daysBefore) },
            actor
          ),
          checklist_template_id: templateId,
          state: 'offen',
        })
        .execute();
    }
    return items.length;
  });
}
export interface ExtractedTask extends Omit<TaskInput, 'project'> {
  quote: string;
  projectTitle?: string;
  assignmentResolution?: 'matched' | 'declined';
}
/** Completed versions include empty extraction results and survive task decisions. */
export async function hasTaskRecognition(
  sourceId: string,
  sourceVersion: string
): Promise<boolean> {
  return !!(await getDb()
    .selectFrom('organisation.task_recognition')
    .select('source_id')
    .where('source_id', '=', sourceId)
    .where('source_version', '=', sourceVersion)
    .executeTakeFirst());
}
/** Repeating recognition of the same source never duplicates or resets a decision. */
export async function storeTaskSuggestions(
  sourceId: string,
  sourceVersion: string,
  items: ExtractedTask[],
  actor: string
): Promise<number> {
  return inTransaction(async (trx) => {
    await lockResource(trx, `task-suggestions:${sourceId}`);
    // One complete batch per content version: even a nondeterministic model title cannot
    // recreate a task that was accepted or rejected during an earlier recognition.
    const batch = await trx
      .selectFrom('organisation.task_recognition')
      .select('source_id')
      .where('source_id', '=', sourceId)
      .where('source_version', '=', sourceVersion)
      .executeTakeFirst();
    if (batch) return 0;
    const currentProjects = taskProjects(
      await trx
        .selectFrom('organisation.task')
        .select(['project', 'state'])
        .where('project', '<>', '')
        .execute()
    );
    const existingKeys = new Set(
      (
        await trx
          .selectFrom('organisation.task')
          .select('source_key')
          .where('source_id', '=', sourceId)
          .where('source_version', '=', sourceVersion)
          .execute()
      ).map((row) => row.source_key)
    );
    let added = 0;
    for (const item of items) {
      const key = createHash('sha256')
        .update(JSON.stringify([sourceId, sourceVersion, item.title, item.quote]))
        .digest('hex');
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      const matching = item.projectTitle
        ? currentProjects.find(
            (project) => projectKey(project.title) === projectKey(item.projectTitle!)
          )
        : undefined;
      await trx
        .insertInto('organisation.task')
        .values({
          ...columns({ ...item, project: matching?.title ?? '' }, actor),
          assignee: item.assignee,
          assignment_resolution: item.assignmentResolution ?? 'legacy',
          suggested_assignee_name: item.assignees?.some((person) => person.login)
            ? item.assignee
            : '',
          suggested_project_title: matching ? '' : (item.projectTitle ?? ''),
          state: 'vorschlag',
          source_id: sourceId,
          source_version: sourceVersion,
          quote: item.quote,
          source_key: key,
        })
        .execute();
      added++;
    }
    await trx
      .insertInto('organisation.task_recognition')
      .values({ source_id: sourceId, source_version: sourceVersion })
      .execute();
    return added;
  });
}
/** The source is checked by the endpoint before accepting; the rowversion protects the decision. */
export async function decideTaskSuggestion(
  id: number,
  input: TaskInput,
  accept: boolean,
  etag: string | undefined,
  actor: string,
  newProjectTitle?: string
): Promise<void> {
  input = await preserveLegacyPeople(id, input);
  if (accept && newProjectTitle) {
    if (input.project)
      throw new ValidationError({
        project: 'Bitte ein bestehendes oder ein neues Projekt wählen.',
      });
    input = { ...input, project: newProjectTitle };
  }
  await inTransaction(async (trx) => {
    const result = await trx
      .updateTable('organisation.task')
      .set({
        ...columns(accept ? await withProject(input, trx) : input, actor),
        state: accept ? 'offen' : 'abgelehnt',
        suggested_project_title: '',
        suggested_assignee_name: '',
      })
      .where('id', '=', id)
      .where('state', '=', 'vorschlag')
      .where('version', '=', requireVersion(etag))
      .output('inserted.id')
      .executeTakeFirst();
    if (!result) throw new VersionConflictError();
  });
}
