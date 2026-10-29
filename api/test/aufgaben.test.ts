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
  deleteTaskProject,
  decideTaskSuggestion,
  getTaskProjects,
  getTask,
  getTasks,
  getTaskTemplates,
  hasTaskRecognition,
  saveTaskProject,
  saveTaskTemplate,
  storeTaskSuggestions,
  updateTask,
} from '../lib/aufgaben';
import { dbTest } from './fixtures/database';
import { recordQueries } from './fixtures/queries';
import { seedPreviewTasks } from '../lib/db-preview';
import { ValidationError } from '../lib/validation/errors';

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
  assert.equal(tasks[0].assignee, ''); // Never accept a model-invented address outside the directory.
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

dbTest('tasks are read with only the columns they return, unchanged', async (t) => {
  const db = getDb();
  const project = await db
    .insertInto('organisation.project')
    .values({ title: 'Sommerlager', campflow_id: '', updated_by: 'test' })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  const protokoll = await db
    .insertInto('protokoll.protokoll')
    .values({
      title: 'Leitendenrunde',
      meeting_date: '2026-10-07',
      content: '{}',
      created_by: 'test',
      updated_by: 'test',
    })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('organisation.task')
    .values([
      {
        title: 'Zelte prüfen',
        description: 'Alle Heringe zählen.',
        assignee: 'Mara Bertram',
        assignees:
          '[{"name":"Mara Bertram","login":"mara@example.test"},{"name":"Bea","login":""}]',
        due_date: '2026-11-01',
        project_id: project.id,
        state: 'offen',
        suggested_project_title: 'Lager',
        suggested_assignee_name: 'Mara',
        assignment_resolution: 'matched',
        source_id: 'P1',
        source_version: 'v1',
        source_key: 'P1:1',
        quote: '@Mara prüft die Zelte.',
        protokoll_id: protokoll.id,
        protokoll_aufgabe: 'a1',
        protokoll_punkt: '3. Lager',
        updated_by: 'test',
      },
      {
        title: 'Altes Thema',
        description: '',
        assignee: 'Hugo Beispiel',
        due_date: null,
        project_id: null,
        state: 'erledigt',
        updated_by: 'test',
      },
    ])
    .execute();

  const queries = recordQueries(t);
  const tasks = await getTasks();
  const withoutEtags = tasks.map(({ etag, ...task }) => {
    assert.match(etag, /^"[0-9a-f]{16}"$/);
    return task;
  });
  assert.deepEqual(withoutEtags, [
    {
      id: tasks[0]?.id,
      title: 'Zelte prüfen',
      description: 'Alle Heringe zählen.',
      assignee: 'Mara Bertram',
      assignees: [
        { name: 'Mara Bertram', login: 'mara@example.test' },
        { name: 'Bea', login: '' },
      ],
      dueDate: '2026-11-01',
      projectId: project.id,
      suggestedProjectTitle: 'Lager',
      suggestedAssigneeName: 'Mara',
      assignmentResolution: 'matched',
      state: 'offen',
      sourceId: 'P1',
      sourceVersion: 'v1',
      quote: '@Mara prüft die Zelte.',
      protokollId: protokoll.id,
      protokollPunkt: '3. Lager',
    },
    {
      id: tasks[1]?.id,
      title: 'Altes Thema',
      description: '',
      assignee: 'Hugo Beispiel',
      assignees: [{ name: 'Hugo Beispiel', login: '' }],
      dueDate: null,
      projectId: null,
      suggestedProjectTitle: '',
      suggestedAssigneeName: '',
      assignmentResolution: 'legacy',
      state: 'erledigt',
      sourceId: '',
      sourceVersion: '',
      quote: '',
      protokollId: null,
      protokollPunkt: '',
    },
  ]);
  assert.deepEqual(await getTasks({ dueDates: ['2026-11-01'], state: 'offen' }), [tasks[0]]);
  assert.deepEqual(await getTask(tasks[1]?.id ?? 0), tasks[1]);
  // Neither the change log nor the internal keys leave the database
  assert.ok(queries.statements.every((statement) => !/select \*|updated_by/.test(statement)));
});

dbTest('task writes require the loaded rowversion and preserve source review rules', async () => {
  await createTask(input, 'test');
  const task = (await getTasks())[0];
  const updated = await updateTask(
    task.id,
    { ...input, title: 'Zelte reparieren' },
    true,
    task.etag,
    'test'
  );
  await assert.rejects(updateTask(task.id, input, false, task.etag, 'test'), VersionConflictError);
  const current = (await getTasks())[0];
  assert.deepEqual(updated, current);
  assert.notEqual(updated.etag, task.etag);
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
  assert.equal(tasks.length, 4);
  assert.equal(
    (await getDb().selectFrom('organisation.task_reminder_delivery').selectAll().execute()).length,
    1
  );
  assert.equal(
    (await getDb().selectFrom('organisation.task_recognition').selectAll().execute()).length,
    1
  );
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
  assert.equal((await getTasks()).length, 4);
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
  assert.equal((await getTasks()).length, 4);
  assert.equal((await getTasks()).filter((t) => t.title === 'Material prüfen').length, 1);
  await seedPreviewTasks();
  assert.equal((await getTasks()).length, 4);
});

dbTest('manual names stay manual and legacy edits do not fabricate reminder logins', async () => {
  await createTask({ ...input, assignee: 'Hugo Beispiel' }, 'test');
  const task = (await getTasks()).find((task) => task.title === input.title)!;
  assert.equal(task.assignee, 'Hugo Beispiel');
  assert.deepEqual(task.assignees, [{ name: 'Hugo Beispiel', login: '' }]);
  await updateTask(task.id, { ...input, assignee: '@Hugo Beispiel' }, false, task.etag, 'test');
  assert.equal((await getTasks()).find((item) => item.id === task.id)?.assignee, 'Hugo Beispiel');
});

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
      { name: 'Hugo Beispiel', login: '' },
    ]);
  }
);

test('project proposals must be grounded in protocol headings or tags', () => {
  const text = '#Winterlager\nAlex prüft die Zelte.\nSommerlager: Bea plant die Küche.';
  const quote = 'Alex prüft die Zelte.';
  const raw = {
    tasks: [
      { ...input, title: 'Winterzelte', quote, projectTitle: 'Winterlager' },
      { ...input, title: 'Erfundene Zuordnung', quote, projectTitle: 'Erfundene Aktion' },
      { ...input, title: 'Küche', quote: 'Bea plant die Küche.', projectTitle: 'Sommerlager' },
    ],
  };
  const result = parseTaskSuggestions(raw, text);
  assert.equal(result[0].projectTitle, 'Winterlager');
  assert.equal(result[1].projectTitle, undefined);
  assert.equal(result[2].projectTitle, 'Sommerlager');
});

dbTest(
  'project deletion rejects stale versions atomically and preserves tasks and templates',
  async () => {
    await saveTaskProject('Lager', '', 'test');
    await saveTaskTemplate(templateInput, 'test');
    const project = (await getTaskProjects())[0];
    const template = (await getTaskTemplates())[0];
    await applyTaskTemplate(project.id, template.id, '2026-12-01', template.etag, 'test');
    const task = (await getTasks())[0];
    await saveTaskProject('Neuer Name', '', 'test', project.id, project.etag);
    await assert.rejects(deleteTaskProject(project.id, project.etag, 'test'), VersionConflictError);
    assert.equal((await getTasks())[0].etag, task.etag);
    assert.equal((await getTasks())[0].projectId, project.id);
    assert.equal(
      (await getDb().selectFrom('organisation.checklist').selectAll().execute()).length,
      1
    );
    const current = (await getTaskProjects())[0];
    await assert.rejects(deleteTaskProject(current.id, undefined, 'test'), VersionConflictError);
    await deleteTaskProject(current.id, current.etag, 'test');
    assert.equal((await getTaskProjects()).length, 0);
    assert.equal((await getTasks())[0].projectId, null);
    assert.notEqual((await getTasks())[0].etag, task.etag);
    assert.equal((await getTaskTemplates()).length, 1);
    assert.equal(
      (await getDb().selectFrom('organisation.checklist').selectAll().execute()).length,
      0
    );
  }
);

dbTest(
  'recognition assigns only an unambiguous existing project and keeps new ideas as task proposals',
  async () => {
    await saveTaskProject('Winterlager', '', 'test');
    const project = (await getTaskProjects())[0];
    const proposals = [
      { ...input, title: 'Zelte', quote: 'Zelte für Winterlager', projectTitle: 'winterlager' },
      { ...input, title: 'Küche', quote: 'Küche für Sommerlager', projectTitle: 'Sommerlager' },
    ];
    await storeTaskSuggestions('P1', 'v1', proposals, 'test');
    const tasks = await getTasks();
    assert.equal(tasks[0].projectId, project.id);
    assert.equal(tasks[0].suggestedProjectTitle, '');
    assert.equal(tasks[1].projectId, null);
    assert.equal(tasks[1].suggestedProjectTitle, 'Sommerlager');
    assert.equal((await getTaskProjects()).length, 1);
    await assert.rejects(
      decideTaskSuggestion(tasks[1].id, input, true, undefined, 'test', 'Sommerlager'),
      VersionConflictError
    );
    assert.equal((await getTaskProjects()).length, 1);
    await decideTaskSuggestion(tasks[1].id, input, true, tasks[1].etag, 'test', 'Sommerlager');
    assert.equal((await getTaskProjects()).length, 2);
    assert.equal((await getTasks())[1].state, 'offen');
    assert.equal((await getTasks())[1].suggestedProjectTitle, '');
  }
);

dbTest('accepting matching project ideas concurrently reuses one project', async () => {
  await storeTaskSuggestions(
    'P1',
    'v1',
    [
      { ...input, title: 'Zelte', quote: 'Zelte für Winterlager', projectTitle: 'Winterlager' },
      { ...input, title: 'Küche', quote: 'Küche für Winterlager', projectTitle: 'Winterlager' },
    ],
    'test'
  );
  const tasks = await getTasks();
  await Promise.all(
    tasks.map((task) =>
      decideTaskSuggestion(task.id, input, true, task.etag, 'test', 'Winterlager')
    )
  );
  assert.equal((await getTaskProjects()).length, 1);
  const accepted = await getTasks();
  assert.equal(accepted[0].projectId, accepted[1].projectId);
  assert.ok(accepted[0].projectId);
});

dbTest('empty recognition is durable and a changed version remains eligible', async () => {
  assert.equal(await hasTaskRecognition('P1', 'empty'), false);
  assert.equal(await storeTaskSuggestions('P1', 'empty', [], 'test'), 0);
  assert.equal(await hasTaskRecognition('P1', 'empty'), true);
  assert.equal(
    await storeTaskSuggestions(
      'P1',
      'empty',
      [{ ...input, quote: 'Spätere Modellantwort' }],
      'test'
    ),
    0
  );
  assert.equal((await getTasks()).length, 0);
  assert.equal(await hasTaskRecognition('P1', 'changed'), false);
  assert.equal(
    await storeTaskSuggestions('P1', 'changed', [{ ...input, quote: 'Neuer Inhalt' }], 'test'),
    1
  );
});

dbTest(
  'project deletion and new task references serialize without foreign-key failures',
  async () => {
    for (let round = 0; round < 5; round++) {
      await saveTaskProject(`Projekt ${round}`, '', 'test');
      const project = (await getTaskProjects()).find((p) => p.title === `Projekt ${round}`)!;
      const writes = await Promise.allSettled([
        createTask({ ...input, projectId: project.id }, 'test'),
        deleteTaskProject(project.id, project.etag, 'test'),
      ]);
      assert.equal(writes[1].status, 'fulfilled');
      if (writes[0].status === 'rejected') assert.ok(writes[0].reason instanceof ValidationError);
      assert.ok((await getTasks()).every((task) => task.projectId !== project.id));
    }
  }
);

dbTest(
  'missing project references report validation errors and leave task data unchanged',
  async () => {
    const invalid = { ...input, projectId: 999999999 };
    const missing = (error: unknown): boolean =>
      error instanceof ValidationError && Boolean(error.fields.projectId);
    await assert.rejects(createTask(invalid, 'test'), missing);
    assert.equal((await getTasks()).length, 0);
    await createTask(input, 'test');
    const task = (await getTasks())[0];
    await assert.rejects(updateTask(task.id, invalid, false, task.etag, 'test'), missing);
    const unchanged = (await getTasks())[0];
    assert.equal(unchanged.etag, task.etag);
    assert.equal(unchanged.projectId, null);
  }
);

dbTest('task CHECK failures are not mislabeled as a missing project', async () => {
  await assert.rejects(
    createTask(
      { title: '', description: '', assignee: '', dueDate: null, projectId: null },
      'test'
    ),
    (error) => {
      assert.equal(error instanceof ValidationError, false);
      return true;
    }
  );
});

dbTest(
  'directory suggestions retain the source name until a reviewer accepts the assignment',
  async () => {
    const person = { name: 'Katharina Muster', login: 'katharina.muster@stamm-phoenix.de' };
    await storeTaskSuggestions(
      'directory-test',
      'v1',
      [
        {
          ...input,
          assignee: 'Kathi',
          assignees: [person],
          quote: 'Kathi organisiert das Treffen.',
        },
      ],
      'test'
    );
    const suggestion = (await getTasks())[0];
    assert.equal(suggestion.state, 'vorschlag');
    assert.equal(suggestion.suggestedAssigneeName, 'Kathi');
    assert.deepEqual(suggestion.assignees, [person]);
    await decideTaskSuggestion(suggestion.id, suggestion, true, suggestion.etag, 'reviewer');
    const accepted = (await getTasks())[0];
    assert.equal(accepted.state, 'offen');
    assert.equal(accepted.suggestedAssigneeName, '');
    assert.deepEqual(accepted.assignees, [person]);
  }
);

dbTest('suggestions retain source names and persisted model vetoes', async () => {
  await storeTaskSuggestions(
    'assignment-resolution',
    'v1',
    [
      {
        ...input,
        assignee: 'Kathi',
        dueDate: null,
        quote: 'Kathi prüft die Zelte.',
        assignmentResolution: 'declined',
        assignees: [{ name: 'Kathi', login: '' }],
      },
    ],
    'test'
  );
  const task = (await getTasks()).find((item) => item.sourceId === 'assignment-resolution')!;
  assert.equal(task.assignmentResolution, 'declined');
  assert.equal(task.assignee, 'Kathi');
  assert.equal(task.assignees?.[0].login, '');
});
