import assert from 'node:assert/strict';
import { applyTaskTemplate, getTasks, getTaskProjects, getTaskTemplates } from '../lib/aufgaben';
import { saveTaskProject, saveTaskTemplate, storeTaskSuggestions } from '../lib/aufgaben';
import { dbTest } from './fixtures/database';

const base = { description: '', assignee: '', dueDate: null, projectId: null };

dbTest('a template creates all its tasks, each with its own due date', async () => {
  await saveTaskProject('Lager', '', 'test');
  await saveTaskTemplate(
    {
      title: 'Lager',
      items: [
        { title: 'Zelte prüfen', description: '', assignee: '', daysBefore: 7 },
        { title: 'Essen planen', description: 'Liste', assignee: '', daysBefore: 14 },
        { title: 'Bus buchen', description: '', assignee: '', daysBefore: 0 },
      ],
    },
    'test'
  );
  const project = (await getTaskProjects())[0];
  const template = (await getTaskTemplates())[0];
  assert.equal(
    await applyTaskTemplate(project.id, template.id, '2026-11-01', template.etag, 'test'),
    3
  );
  const tasks = (await getTasks()).sort((a, b) => a.title.localeCompare(b.title, 'de'));
  assert.deepEqual(
    tasks.map((task) => [task.title, task.dueDate, task.projectId, task.state]),
    [
      ['Bus buchen', '2026-11-01', project.id, 'offen'],
      ['Essen planen', '2026-10-18', project.id, 'offen'],
      ['Zelte prüfen', '2026-10-25', project.id, 'offen'],
    ]
  );
});

dbTest('more suggestions than fit one statement are all stored, once', async () => {
  const suggestions = Array.from({ length: 120 }, (_, index) => ({
    ...base,
    title: `Aufgabe ${index}`,
    quote: `Zitat ${index}`,
  }));
  assert.equal(await storeTaskSuggestions('P1', 'v1', suggestions, 'test'), 120);
  assert.equal(await storeTaskSuggestions('P1', 'v1', suggestions, 'test'), 0);
  const stored = (await getTasks()).filter((task) => task.state === 'vorschlag');
  assert.equal(stored.length, 120);
});
