import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTask, validateTemplate } from '../lib/aufgaben-validation';
import { parseTaskSuggestions, detectProtokollTasks } from '../lib/protokoll-aufgaben';
import { CONFIG } from '../lib/config';
import { overrideConfig } from './fixtures/config';
import { getDb, VersionConflictError } from '../lib/db';
import {
  applyTaskTemplate,
  createTask,
  deleteTask,
  decideTaskSuggestion,
  getTaskProjects,
  getTasks,
  getTaskTemplates,
  saveTaskProject,
  saveTaskTemplate,
  storeTaskSuggestions,
  updateTask,
} from '../lib/aufgaben';
import { dbTest } from './fixtures/database';
import { seedPreviewTasks } from '../lib/db-preview';
import { ValidationError } from '../lib/pflege-validation';

const input = {
  title: 'Zelte prüfen',
  description: '',
  assignee: 'alex@example.test',
  dueDate: '2026-10-11',
  projectId: null,
};
const templateInput = {
  title: 'Lager',
  items: [{ title: 'Zelte prüfen', description: '', assignee: '', daysBefore: 7 }],
};

test('task validation rejects impossible dates, malformed references and oversized names', () => {
  assert.deepEqual(validateTask(input), input);
  for (const dueDate of ['2026-02-29', '0000-01-01', 'morgen', 1])
    assert.throws(() => validateTask({ ...input, dueDate }));
  for (const projectId of ['1', 0, -1, 1.5])
    assert.throws(() => validateTask({ ...input, projectId }));
  assert.throws(() => validateTask({ ...input, title: ' ' }));
  assert.throws(() => validateTask({ ...input, assignee: 'x'.repeat(255) }));
  assert.throws(() => validateTask({ ...input, description: {} }));
  assert.throws(() => validateTemplate({ ...templateInput, items: [] }));
  assert.throws(() =>
    validateTemplate({ ...templateInput, items: [{ ...templateInput.items[0], daysBefore: 1.5 }] })
  );
});
test('model suggestions need a real quote; duplicates and malformed data are discarded', () => {
  const quote = 'Alex prüft die Zelte bis zum 11. Oktober.';
  const valid = { ...input, quote };
  const tasks = parseTaskSuggestions(
    {
      tasks: [valid, valid, { ...valid, quote: 'Eine erfundene Passage' }, { ...valid, title: '' }],
    },
    quote
  );
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].assignee, input.assignee);
  assert.equal(
    parseTaskSuggestions({ tasks: [{ ...valid, dueDate: '2026-02-30' }] }, quote)[0].dueDate,
    null
  );
  assert.throws(() => parseTaskSuggestions({}, quote));
});
test('a zero daily extraction limit disables recognition before reading Word or invoking the model', async (t) => {
  overrideConfig(t, CONFIG.protokolle.aufgaben, { maxExtractionsPerDay: 0 });
  await assert.rejects(
    detectProtokollTasks(new Uint8Array(), '2026-10-07'),
    (e: unknown) => e instanceof Error && 'fields' in e
  );
});

dbTest('task writes require the loaded rowversion and preserve source review rules', async () => {
  await createTask(input, 'test');
  const task = (await getTasks())[0];
  await updateTask(task.id, { ...input, title: 'Zelte reparieren' }, true, task.etag, 'test');
  await assert.rejects(updateTask(task.id, input, false, task.etag, 'test'), VersionConflictError);
  const current = (await getTasks())[0];
  assert.equal(current.title, 'Zelte reparieren');
  assert.equal(current.state, 'erledigt');
  await assert.rejects(updateTask(task.id, input, false, undefined, 'test'), VersionConflictError);
});
dbTest(
  'applying a template concurrently creates one complete checklist with UTC-relative dates',
  async () => {
    await saveTaskProject('Lager', '', 'test');
    await saveTaskTemplate(templateInput, 'test');
    const project = (await getTaskProjects())[0];
    const template = (await getTaskTemplates())[0];
    const counts = await Promise.all(
      [1, 2].map(() =>
        applyTaskTemplate(project.id, template.id, '2026-11-01', template.etag, 'test')
      )
    );
    assert.deepEqual(counts.sort(), [0, 1]);
    const tasks = await getTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].dueDate, '2026-10-25');
    assert.equal(tasks[0].projectId, project.id);
    assert.equal(
      (await getDb().selectFrom('organisation.checklist').selectAll().execute()).length,
      1
    );
    await saveTaskTemplate(
      { ...templateInput, title: 'Neuer Name' },
      'test',
      template.id,
      template.etag
    );
    await assert.rejects(
      applyTaskTemplate(project.id, template.id, '2026-11-01', template.etag, 'test'),
      VersionConflictError
    );
  }
);
dbTest(
  'concurrent extraction is idempotent and acceptance creates one task without resetting decisions',
  async () => {
    const suggestion = { ...input, quote: 'Alex prüft die Zelte.' };
    const counts = await Promise.all(
      [1, 2].map(() => storeTaskSuggestions('P1', 'fingerprint', [suggestion], 'test'))
    );
    assert.deepEqual(counts.sort(), [0, 1]);
    const task = (await getTasks())[0];
    assert.equal(task.state, 'vorschlag');
    await assert.rejects(updateTask(task.id, input, true, task.etag, 'test'), VersionConflictError);
    await decideTaskSuggestion(
      task.id,
      { ...input, assignee: 'bea@example.test' },
      true,
      task.etag,
      'reviewer'
    );
    await assert.rejects(
      decideTaskSuggestion(task.id, input, true, task.etag, 'reviewer'),
      VersionConflictError
    );
    assert.equal(await storeTaskSuggestions('P1', 'fingerprint', [suggestion], 'test'), 0);
    assert.equal(
      await storeTaskSuggestions(
        'P1',
        'fingerprint',
        [{ ...suggestion, title: 'Anderer KI-Titel' }],
        'test'
      ),
      0
    );
    const tasks = await getTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].state, 'offen');
    assert.equal(tasks[0].assignee, 'bea@example.test');
  }
);
dbTest('rejected suggestions remain rejected on repeated extraction', async () => {
  const suggestion = { ...input, quote: 'Alex prüft die Zelte.' };
  await storeTaskSuggestions('P1', 'fingerprint', [suggestion], 'test');
  const task = (await getTasks())[0];
  await decideTaskSuggestion(task.id, input, false, task.etag, 'reviewer');
  assert.equal(await storeTaskSuggestions('P1', 'fingerprint', [suggestion], 'test'), 0);
  assert.equal(
    await storeTaskSuggestions(
      'P1',
      'fingerprint',
      [{ ...suggestion, title: 'Anderer KI-Titel' }],
      'test'
    ),
    0
  );
  assert.equal((await getTasks())[0].state, 'abgelehnt');
});
dbTest('source task deletion distinguishes a prohibited action from a stale version', async () => {
  await storeTaskSuggestions(
    'P1',
    'fingerprint',
    [{ ...input, quote: 'Alex prüft die Zelte.' }],
    'test'
  );
  const task = (await getTasks())[0];
  await assert.rejects(deleteTask(task.id, task.etag), ValidationError);
  await assert.rejects(deleteTask(task.id, undefined), VersionConflictError);
  await decideTaskSuggestion(task.id, input, true, task.etag, 'reviewer');
  await assert.rejects(deleteTask(task.id, task.etag), VersionConflictError);
  const accepted = (await getTasks())[0];
  await assert.rejects(deleteTask(task.id, accepted.etag), ValidationError);
  assert.equal((await getTasks()).length, 1);
  await createTask(input, 'test');
  const manual = (await getTasks()).find((t) => !t.sourceId)!;
  await deleteTask(manual.id, manual.etag);
  assert.equal((await getTasks()).length, 1);
});
dbTest('task preview seeding fills every table and repeated runs preserve edits', async () => {
  await seedPreviewTasks();
  const tasks = await getTasks();
  assert.equal(tasks.length, 3);
  const task = tasks.find((t) => t.state === 'offen')!;
  assert.equal(task.assignees?.length, 2);
  await updateTask(task.id, { ...task, title: 'Umbenannte Aufgabe' }, true, task.etag, 'test');
  const project = (await getTaskProjects())[0];
  const template = (await getTaskTemplates())[0];
  await saveTaskProject('Umbenanntes Projekt', '', 'test', project.id, project.etag);
  await saveTaskTemplate(
    { ...template, title: 'Umbenannte Vorlage' },
    'test',
    template.id,
    template.etag
  );
  await getDb()
    .updateTable('organisation.task')
    .set({ title: 'Umbenannter Vorschlag' })
    .where('state', '=', 'vorschlag')
    .execute();
  await seedPreviewTasks();
  assert.equal((await getTasks()).length, 3);
  assert.equal((await getTasks()).find((t) => t.id === task.id)?.state, 'erledigt');
  assert.equal((await getTasks()).find((t) => t.id === task.id)?.title, 'Umbenannte Aufgabe');
  assert.equal((await getTaskProjects())[0].title, 'Umbenanntes Projekt');
  assert.equal((await getTaskTemplates())[0].title, 'Umbenannte Vorlage');
  assert.equal((await getTaskProjects()).length, 1);
  assert.equal((await getTaskTemplates()).length, 1);
  assert.equal(
    (await getDb().selectFrom('organisation.checklist').selectAll().execute()).length,
    1
  );
  await getDb().deleteFrom('organisation.task').where('id', '=', task.id).execute();
  await seedPreviewTasks();
  assert.equal((await getTasks()).length, 3);
  assert.equal((await getTasks()).filter((t) => t.title === 'Preview: Material prüfen').length, 1);
  await seedPreviewTasks();
  assert.equal((await getTasks()).length, 3);
});

dbTest(
  'manual names are saved as staff logins and a later edit preserves personal assignment',
  async () => {
    await createTask({ ...input, assignee: 'Hugo Beispiel' }, 'test');
    const task = (await getTasks()).find((task) => task.title === input.title)!;
    assert.equal(task.assignee, 'hugo.beispiel@stamm-phoenix.de');
    await updateTask(task.id, { ...input, assignee: '@Hugo Beispiel' }, false, task.etag, 'test');
    assert.equal(
      (await getTasks()).find((item) => item.id === task.id)?.assignee,
      'hugo.beispiel@stamm-phoenix.de'
    );
  }
);

test('multi-person task and template input validates, deduplicates and rejects invalid identities', () => {
  const assignees = [
    { name: 'Alex Beispiel', login: 'alex@example.test' },
    { name: 'Bea Beispiel', login: 'bea@example.test' },
  ];
  assert.deepEqual(
    validateTask({ ...input, assignees: [...assignees, assignees[0]] }).assignees,
    assignees
  );
  assert.deepEqual(
    validateTemplate({ ...templateInput, items: [{ ...templateInput.items[0], assignees }] })
      .items[0].assignees,
    assignees
  );
  for (const value of [
    null,
    'Alex',
    [{ name: 'Alex', login: 'bad login' }],
    [{ name: '', login: 'alex@example.test' }],
    Array(21).fill(assignees[0]),
  ])
    assert.throws(() => validateTask({ ...input, assignees: value }), ValidationError);
});
dbTest(
  'multiple assignees survive SQL writes, conditional edits and legacy row reads',
  async () => {
    const assignees = [
      { name: 'Alex Beispiel', login: 'alex@example.test' },
      { name: 'Bea Beispiel', login: 'bea@example.test' },
    ];
    await createTask({ ...input, assignees }, 'test');
    let task = (await getTasks())[0];
    assert.deepEqual(task.assignees, assignees);
    await updateTask(
      task.id,
      { ...input, title: 'Older client title edit' },
      false,
      task.etag,
      'test'
    );
    task = (await getTasks())[0];
    assert.deepEqual(task.assignees, assignees);
    await updateTask(task.id, { ...task, assignees: [assignees[1]] }, false, task.etag, 'test');
    task = (await getTasks())[0];
    assert.deepEqual(task.assignees, [assignees[1]]);
    assert.equal(task.assignee, 'bea@example.test');
    await assert.rejects(
      updateTask(task.id, { ...task, assignees }, false, '"0000000000000001"', 'test'),
      VersionConflictError
    );
    await updateTask(task.id, { ...task, assignees: [] }, false, task.etag, 'test');
    task = (await getTasks())[0];
    assert.deepEqual(task.assignees, []);
    assert.equal(task.assignee, '');
    await getDb()
      .insertInto('organisation.task')
      .values({
        title: 'Legacy',
        description: '',
        assignee: 'Hugo Beispiel',
        due_date: null,
        project_id: null,
        state: 'offen',
        updated_by: 'test',
      })
      .execute();
    assert.deepEqual((await getTasks()).find((item) => item.title === 'Legacy')?.assignees, [
      { name: 'Hugo Beispiel', login: 'hugo.beispiel@stamm-phoenix.de' },
    ]);
  }
);
