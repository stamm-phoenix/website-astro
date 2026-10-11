import { createHash } from 'node:crypto';
import type { Selectable } from 'kysely';
import type { TaskTable } from './db-schema';
import type { Task, TaskInput, TaskProject, TaskTemplate, TemplateItem } from './aufgaben-model';
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

function toTask(row: Selectable<TaskTable>): Task {
  return {
    id: row.id,
    etag: toVersion(row.version),
    title: row.title,
    description: row.description,
    assignee: row.assignee,
    dueDate: row.due_date ? toDateString(row.due_date) : null,
    projectId: row.project_id,
    state: row.state,
    sourceId: row.source_id,
    sourceVersion: row.source_version,
    quote: row.quote,
  };
}
export async function getTasks(): Promise<Task[]> {
  return (await getDb().selectFrom('organisation.task').selectAll().orderBy('id').execute()).map(
    toTask
  );
}
export async function getTask(id: number): Promise<Task | undefined> {
  const row = await getDb()
    .selectFrom('organisation.task')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toTask(row) : undefined;
}
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
export async function getTaskTemplates(): Promise<TaskTemplate[]> {
  return (
    await getDb().selectFrom('organisation.template').selectAll().orderBy('title').execute()
  ).map((row) => ({
    id: row.id,
    etag: toVersion(row.version),
    ...validateTemplate({ title: row.title, items: JSON.parse(row.items) as unknown }),
  }));
}
export async function saveTaskProject(
  title: string,
  campflowId: string,
  actor: string,
  id?: number,
  etag?: string
): Promise<void> {
  const values = { title, campflow_id: campflowId, updated_by: actor };
  if (id === undefined) {
    await getDb().insertInto('organisation.project').values(values).execute();
  } else {
    const changed = await getDb()
      .updateTable('organisation.project')
      .set(values)
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .output('inserted.id')
      .executeTakeFirst();
    if (!changed) throw new VersionConflictError();
  }
}
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
function columns(input: TaskInput, actor: string) {
  return {
    title: input.title,
    description: input.description,
    assignee: input.assignee,
    due_date: input.dueDate,
    project_id: input.projectId,
    updated_by: actor,
  };
}
/** Validate references before writes rather than exposing foreign-key errors to callers. */
async function assertProject(projectId: number | null): Promise<void> {
  if (projectId === null) return;
  const row = await getDb()
    .selectFrom('organisation.project')
    .select('id')
    .where('id', '=', projectId)
    .executeTakeFirst();
  if (!row) throw new ValidationError({ projectId: 'Das Projekt existiert nicht.' });
}
export async function createTask(input: TaskInput, actor: string): Promise<void> {
  await assertProject(input.projectId);
  await getDb()
    .insertInto('organisation.task')
    .values({ ...columns(input, actor), state: 'offen' })
    .execute();
}
/** Ordinary edits cannot accept or revive suggestions; they use the review endpoint. */
export async function updateTask(
  id: number,
  input: TaskInput,
  done: boolean,
  etag: string | undefined,
  actor: string
): Promise<void> {
  await assertProject(input.projectId);
  const result = await getDb()
    .updateTable('organisation.task')
    .set({ ...columns(input, actor), state: done ? 'erledigt' : 'offen' })
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .where('state', 'in', ['offen', 'erledigt'])
    .output('inserted.id')
    .executeTakeFirst();
  if (!result) throw new VersionConflictError();
}
export async function deleteTask(id: number, etag: string | undefined): Promise<void> {
  // Source rows remain as decision records to prevent repeated extraction recreating tasks.
  const result = await getDb()
    .deleteFrom('organisation.task')
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .where('source_id', '=', '')
    .output('deleted.id')
    .executeTakeFirst();
  if (!result) throw new VersionConflictError();
}
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
  return inTransaction(async (trx) => {
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
      .selectFrom('organisation.task')
      .select('id')
      .where('source_id', '=', sourceId)
      .where('source_version', '=', sourceVersion)
      .executeTakeFirst();
    if (batch) return 0;
    let added = 0;
    for (const item of items) {
      const key = createHash('sha256')
        .update(JSON.stringify([sourceId, sourceVersion, item.title, item.quote]))
        .digest('hex');
      const existing = await trx
        .selectFrom('organisation.task')
        .select('id')
        .where('source_key', '=', key)
        .executeTakeFirst();
      if (existing) continue;
      await trx
        .insertInto('organisation.task')
        .values({
          ...columns({ ...item, projectId: null }, actor),
          state: 'vorschlag',
          source_id: sourceId,
          source_version: sourceVersion,
          quote: item.quote,
          source_key: key,
        })
        .execute();
      added++;
    }
    return added;
  });
}
/** The source is checked by the endpoint before accepting; the rowversion protects the decision. */
export async function decideTaskSuggestion(
  id: number,
  input: TaskInput,
  accept: boolean,
  etag: string | undefined,
  actor: string
): Promise<void> {
  await assertProject(input.projectId);
  const result = await getDb()
    .updateTable('organisation.task')
    .set({ ...columns(input, actor), state: accept ? 'offen' : 'abgelehnt' })
    .where('id', '=', id)
    .where('state', '=', 'vorschlag')
    .where('version', '=', requireVersion(etag))
    .output('inserted.id')
    .executeTakeFirst();
  if (!result) throw new VersionConflictError();
}
