import type { Transaction } from 'kysely';
import { taskPeople } from './aufgaben-zuordnung';
import type { Database } from './db-schema';
import {
  VersionConflictError,
  getDb,
  lockResource,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type {
  OffeneAufgabeQuelle,
  ProtokollEditorAufgaben,
  ProtokollInhalt,
} from './protokoll-editor-model';
import { MAX_TASK_TITLE, einzeilig, protokollEintraege } from './protokoll-editor-model';

/**
 * The minutes of the editor and the module Aufgaben (#277, step 3, `docs/protokoll-editor.md`):
 * the tasks of the minutes become real tasks on approval, new minutes start with the open tasks
 * from earlier minutes, and an item linked to a project shows that project's open tasks.
 */

const LOGIN = /^[^\s@]+@[^\s@]+$/;

/** Projects and open tasks of the module Aufgaben, with the versions to tick them, for the editor. */
export async function getProtokollEditorAufgaben(): Promise<ProtokollEditorAufgaben> {
  const db = getDb();
  const [projects, tasks] = await Promise.all([
    db
      .selectFrom('organisation.project')
      .select(['id', 'title', 'campflow_id'])
      .orderBy('title')
      .execute(),
    db
      .selectFrom('organisation.task')
      .select([
        'id',
        'version',
        'state',
        'title',
        'assignee',
        'assignees',
        'due_date',
        'project_id',
        'source_id',
        'protokoll_id',
      ])
      .where('state', 'in', ['offen', 'erledigt'])
      .orderBy('id')
      .execute(),
  ]);
  return {
    projekte: projects.map((row) => ({
      id: row.id,
      titel: einzeilig(row.title),
      campflowId: row.campflow_id,
    })),
    offen: tasks
      .filter((row) => row.state === 'offen')
      .map((row): OffeneAufgabeQuelle => ({
        id: row.id,
        // Typed in the module, where line breaks are allowed; the minutes hold one line
        titel: einzeilig(row.title),
        zustaendig: taskPeople({
          assignee: row.assignee,
          ...(row.assignees !== '[]' ? { assignees: JSON.parse(row.assignees) } : {}),
        }).map(({ login, name }) => ({ login: einzeilig(login, 254), name: einzeilig(name) })),
        faellig: row.due_date ? toDateString(row.due_date) : '',
        projektId: row.project_id,
        ausProtokoll: row.protokoll_id !== null || row.source_id !== '',
      })),
    versionen: Object.fromEntries(tasks.map((row) => [row.id, toVersion(row.version)])),
  };
}

/**
 * Ticks a task off or opens it again, if it is still the version the editor knows. Returns the
 * new version, or `undefined` if the task does not exist or is a proposal; a changed task is a
 * `VersionConflictError`.
 */
export async function setOffeneAufgabeErledigt(
  id: number,
  erledigt: boolean,
  etag: string | undefined,
  actor: string
): Promise<string | undefined> {
  const version = requireVersion(etag);
  const db = getDb();
  const result = await db
    .updateTable('organisation.task')
    .set({ state: erledigt ? 'erledigt' : 'offen', updated_by: actor })
    .where('id', '=', id)
    .where('state', 'in', ['offen', 'erledigt'])
    .where('version', '=', version)
    .output('inserted.version')
    .executeTakeFirst();
  if (result) return toVersion(result.version);
  const exists = await db
    .selectFrom('organisation.task')
    .select('id')
    .where('id', '=', id)
    .where('state', 'in', ['offen', 'erledigt'])
    .executeTakeFirst();
  if (exists) throw new VersionConflictError();
  return undefined;
}

/** Title and description of the task; a title longer than the module takes is cut there. */
function taskTitle(titel: string): { title: string; description: string } {
  const text = titel.trim().replace(/\s+/g, ' ');
  if (text.length <= MAX_TASK_TITLE) return { title: text, description: '' };
  return { title: `${text.slice(0, MAX_TASK_TITLE - 1).trimEnd()}…`, description: text };
}

/**
 * Creates the tasks of approved minutes in the module Aufgaben, in the transaction of the
 * approval. Each entry becomes one open task in the project of its item; a project deleted in
 * the meantime is left out. Entries that already have a task are skipped. Returns how many
 * tasks were created.
 */
export async function createProtokollTasks(
  trx: Transaction<Database>,
  protokollId: number,
  inhalt: ProtokollInhalt,
  actor: string
): Promise<number> {
  const eintraege = protokollEintraege(inhalt);
  if (eintraege.length === 0) return 0;
  const projektIds = [...new Set(eintraege.flatMap((e) => (e.projekt ? [e.projekt.id] : [])))].sort(
    (a, b) => a - b
  );
  // Serializes with deleting a project (`deleteTaskProject`), in a fixed order
  for (const projektId of projektIds) await lockResource(trx, `task-project:${projektId}`);
  const existing = new Set(
    projektIds.length === 0
      ? []
      : (
          await trx
            .selectFrom('organisation.project')
            .select('id')
            .where('id', 'in', projektIds)
            .execute()
        ).map((row) => row.id)
  );
  const created = new Set(
    (
      await trx
        .selectFrom('organisation.task')
        .select('protokoll_aufgabe')
        .where('protokoll_id', '=', protokollId)
        .execute()
    ).map((row) => row.protokoll_aufgabe)
  );
  let count = 0;
  for (const { aufgabe, punkt, projekt } of eintraege) {
    if (created.has(aufgabe.id)) continue;
    const people = taskPeople({
      assignee: '',
      assignees: aufgabe.zustaendig
        .filter((person) => person.name.trim() || LOGIN.test(person.login))
        .map((person) => ({
          name: person.name.trim().slice(0, 200),
          login: LOGIN.test(person.login) ? person.login : '',
        })),
    }).slice(0, 20);
    await trx
      .insertInto('organisation.task')
      .values({
        ...taskTitle(aufgabe.titel),
        assignee: (people[0]?.login || people[0]?.name || '').slice(0, 254),
        assignees: JSON.stringify(people),
        due_date: aufgabe.faellig || null,
        project_id: projekt && existing.has(projekt.id) ? projekt.id : null,
        state: 'offen',
        protokoll_id: protokollId,
        protokoll_aufgabe: aufgabe.id,
        protokoll_punkt: punkt,
        updated_by: actor,
      })
      .execute();
    created.add(aufgabe.id);
    count++;
  }
  return count;
}
