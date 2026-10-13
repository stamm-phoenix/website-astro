import { taskPeople, taskAssigneeLogin } from './aufgaben-zuordnung';
import { createHash } from 'node:crypto';
import { sql, type Selectable, type Transaction } from 'kysely';
import type { Database, TaskTable } from './db-schema';
import type { Task, TaskInput, TaskProject, TaskTemplate, TemplateItem } from './aufgaben-model';
import {
  getDb,
  isForeignKeyViolation,
  inTransaction,
  lockResource,
  requireVersion,
  toDateString,
  toVersion,
  VersionConflictError,
} from './db';
import { ValidationError } from './pflege-validation';
import { validateTemplate } from './aufgaben-validation';

function normalizedProjectTitle(title: string): string {
  return title.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');
}
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
    projectId: row.project_id,
    suggestedProjectTitle: row.suggested_project_title,
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
/** List projects alphabetically with their optional CampFlow references. */
export async function getTaskProjects(): Promise<TaskProject[]> {
  return (
    await getDb().selectFrom('organisation.project').selectAll().orderBy('title').execute()
  ).map((row) => ({
    id: row.id,
    etag: toVersion(row.version),
    title: row.title,
    campflowId: row.campflow_id,
  }));
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
/** Create a project or update it only when the supplied rowversion still matches. */
export async function saveTaskProject(
  title: string,
  campflowId: string,
  actor: string,
  id?: number,
  etag?: string
): Promise<void> {
  await inTransaction(async (trx) => {
    await lockResource(trx, 'task-suggested-project-titles');
    const values = { title, campflow_id: campflowId, updated_by: actor };
    if (id === undefined) {
      await trx.insertInto('organisation.project').values(values).execute();
    } else {
      const changed = await trx
        .updateTable('organisation.project')
        .set(values)
        .where('id', '=', id)
        .where('version', '=', requireVersion(etag))
        .output('inserted.id')
        .executeTakeFirst();
      if (!changed) throw new VersionConflictError();
    }
  });
}
/** Remove a versioned project atomically; its tasks remain without a project. */
export async function deleteTaskProject(
  id: number,
  etag: string | undefined,
  actor: string
): Promise<void> {
  const version = requireVersion(etag);
  await inTransaction(async (trx) => {
    await lockProject(trx, id);
    // Claim the parent row after serializing references to this project.
    const claimed = await trx
      .updateTable('organisation.project')
      .set({ updated_by: actor })
      .where('id', '=', id)
      .where('version', '=', version)
      .output('inserted.id')
      .executeTakeFirst();
    if (!claimed) throw new VersionConflictError();
    await trx
      .updateTable('organisation.task')
      .set({ project_id: null, updated_by: actor })
      .where('project_id', '=', id)
      .execute();
    await trx.deleteFrom('organisation.checklist').where('project_id', '=', id).execute();
    await trx.deleteFrom('organisation.project').where('id', '=', id).execute();
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
    project_id: input.projectId,
    updated_by: actor,
  };
}
/** Project-specific lock serializes deletion with new references, without blocking other projects. */
async function lockProject(trx: Transaction<Database>, projectId: number | null): Promise<void> {
  if (projectId !== null) await lockResource(trx, `task-project:${projectId}`);
}
async function withProject<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  try {
    return await inTransaction(work);
  } catch (error) {
    if (isForeignKeyViolation(error, 'fk_task_project'))
      throw new ValidationError({ projectId: 'Das Projekt existiert nicht.' });
    throw error;
  }
}
/** Create an open task after validating its optional project reference. */
export async function createTask(input: TaskInput, actor: string): Promise<void> {
  await withProject(async (trx) => {
    await trx
      .insertInto('organisation.task')
      .values({ ...columns(input, actor), state: 'offen' })
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
  return withProject(async (trx) => {
    const result = await trx
      .updateTable('organisation.task')
      .set({ ...columns(input, actor), state: done ? 'erledigt' : 'offen' })
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
/** Atomic and idempotent per project/template, including concurrent requests. */
export async function applyTaskTemplate(
  projectId: number,
  templateId: number,
  date: string,
  etag: string | undefined,
  actor: string
): Promise<number> {
  return withProject(async (trx) => {
    await lockProject(trx, projectId);
    await lockResource(trx, `checklist:${projectId}:${templateId}`);
    const project = await trx
      .selectFrom('organisation.project')
      .select('id')
      .where('id', '=', projectId)
      .executeTakeFirst();
    const template = await trx
      .selectFrom('organisation.template')
      .selectAll()
      .where('id', '=', templateId)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (!project || !template) throw new VersionConflictError();
    const applied = await trx
      .selectFrom('organisation.checklist')
      .select('project_id')
      .where('project_id', '=', projectId)
      .where('template_id', '=', templateId)
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
          ...columns({ ...item, projectId, dueDate: templateDate(date, item.daysBefore) }, actor),
          state: 'offen',
        })
        .execute();
    }
    await trx
      .insertInto('organisation.checklist')
      .values({ project_id: projectId, template_id: templateId })
      .execute();
    return items.length;
  });
}
export interface ExtractedTask extends Omit<TaskInput, 'projectId'> {
  quote: string;
  projectTitle?: string;
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
    // Lock matching parent rows once; deleting them waits until this batch commits.
    const { rows: currentProjects } = await sql<{
      id: number;
      title: string;
    }>`SELECT id, title FROM organisation.project WITH (HOLDLOCK)`.execute(trx);
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
        ? currentProjects.filter(
            (project) =>
              normalizedProjectTitle(project.title) === normalizedProjectTitle(item.projectTitle!)
          )
        : [];
      await trx
        .insertInto('organisation.task')
        .values({
          ...columns({ ...item, projectId: matching.length === 1 ? matching[0].id : null }, actor),
          suggested_project_title: matching.length === 1 ? '' : (item.projectTitle ?? ''),
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
  await withProject(async (trx) => {
    if (accept && newProjectTitle) {
      await lockResource(trx, 'task-suggested-project-titles');
      if (input.projectId !== null)
        throw new ValidationError({
          projectId: 'Bitte ein bestehendes oder ein neues Projekt wählen.',
        });
      const title = newProjectTitle.trim();
      const matches = (
        await trx.selectFrom('organisation.project').select(['id', 'title']).execute()
      ).filter(
        (project) => normalizedProjectTitle(project.title) === normalizedProjectTitle(title)
      );
      if (matches.length > 1)
        throw new ValidationError({
          projectId: 'Mehrere Projekte heißen gleich. Bitte das passende Projekt auswählen.',
        });
      const project =
        matches[0] ??
        (await trx
          .insertInto('organisation.project')
          .values({ title, campflow_id: '', updated_by: actor })
          .output('inserted.id')
          .executeTakeFirstOrThrow());
      input = { ...input, projectId: project.id };
    }
    const result = await trx
      .updateTable('organisation.task')
      .set({
        ...columns(input, actor),
        state: accept ? 'offen' : 'abgelehnt',
        suggested_project_title: '',
      })
      .where('id', '=', id)
      .where('state', '=', 'vorschlag')
      .where('version', '=', requireVersion(etag))
      .output('inserted.id')
      .executeTakeFirst();
    if (!result) throw new VersionConflictError();
  });
}
