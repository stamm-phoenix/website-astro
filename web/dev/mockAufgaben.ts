/** Shared tasks, projects and templates. */
import { validateTask, validateTemplate } from '../../api/lib/aufgaben-validation';
import { ValidationError } from '../../api/lib/validation/errors';
import { taggedTaskAssignee } from '../../api/lib/aufgaben-zuordnung';
import type { TasksOverview } from '../../api/lib/aufgaben-model';
import { mockAufgabenHooks } from './mock-data/protokollEditor';
import { newEtag, newId } from './mock-data/util';
import { PRINCIPAL } from './mockAuth';
import { error, json, noContent, notFound, route, str } from './mockCore';
import type { Handler, MockResult } from './mockCore';
import { resetStaffFavorites } from './mockStaffPersoenlich';
import { protokolle } from './mockProtokolle';

// Shared tasks; proposals remain separate until a leader accepts them.
export const taskData: TasksOverview = {
  login: PRINCIPAL.userDetails,
  extractionConfigured: true,
  projects: [{ id: 1, etag: newEtag(newId()), title: 'Herbstlager', campflowId: '' }],
  templates: [
    {
      id: 1,
      etag: newEtag(newId()),
      title: 'Lager vorbereiten',
      items: [
        { title: 'Zelte prüfen', description: 'Material durchsehen.', assignee: '', daysBefore: 7 },
        { title: 'Einkauf planen', description: '', assignee: '', daysBefore: 3 },
      ],
    },
  ],
  tasks: [
    {
      id: 1,
      etag: newEtag(newId()),
      title: 'Küche vorbereiten',
      description: 'Speiseplan abstimmen.',
      assignee: PRINCIPAL.userDetails,
      dueDate: '2026-10-12',
      projectId: 1,
      state: 'offen',
      sourceId: '',
      sourceVersion: '',
      quote: '',
    },
  ],
};
const initialTaskData = structuredClone(taskData);
let nextTaskId = 2;
const appliedTaskTemplates = new Set<string>();
const recognizedTaskProtocols = new Set<string>();
const TASK_BASE = '/api/intern/pflege/aufgaben';
route('POST', '/api/__mock/aufgaben/reset', () => {
  resetStaffFavorites();
  Object.assign(taskData, structuredClone(initialTaskData));
  nextTaskId = 2;
  appliedTaskTemplates.clear();
  recognizedTaskProtocols.clear();
  return noContent();
});
route('GET', `${TASK_BASE}/benutzer`, () =>
  json({
    users: [
      { name: 'Demo Leitung', login: PRINCIPAL.userDetails },
      { name: 'Alex Beispiel', login: 'alex@example.test' },
      { name: 'Bea Beispiel', login: 'bea@example.test' },
    ],
    unavailable: false,
  })
);
export const TASK_CONFLICT = (): MockResult =>
  error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
route(['GET', 'POST'], TASK_BASE, (req) => {
  if (req.method === 'GET') return json(taskData);
  taskData.tasks.push({
    id: nextTaskId++,
    etag: newEtag(newId()),
    ...validateTask(req.json),
    state: 'offen',
    sourceId: '',
    sourceVersion: '',
    quote: '',
  });
  return noContent();
});
route(['PUT', 'DELETE'], `${TASK_BASE}/:id`, (req) => {
  const task = taskData.tasks.find((t) => t.id === Number(req.params.id));
  if (!task) return notFound();
  if ((req.method === 'DELETE' ? req.headers['if-match'] : req.json?.etag) !== task.etag)
    return TASK_CONFLICT();
  if (req.method === 'PUT' && typeof req.json?.done !== 'boolean')
    throw new ValidationError({ done: 'Bitte den Erledigt-Status angeben.' });
  if (req.method === 'DELETE') taskData.tasks = taskData.tasks.filter((t) => t.id !== task.id);
  else
    Object.assign(task, {
      ...validateTask(req.json),
      state: req.json?.done ? 'erledigt' : 'offen',
      etag: newEtag(newId()),
    });
  return req.method === 'PUT' ? json(task) : noContent();
});
route('DELETE', `${TASK_BASE}/projekte/:id`, (req) => {
  const id = Number(req.params.id);
  const project = taskData.projects.find((p) => p.id === id);
  if (!project || project.etag !== req.headers['if-match']) return TASK_CONFLICT();
  taskData.projects = taskData.projects.filter((p) => p.id !== id);
  for (const task of taskData.tasks)
    if (task.projectId === id) {
      task.projectId = null;
      task.etag = newEtag(newId());
    }
  for (const key of appliedTaskTemplates)
    if (key.startsWith(`${id}:`)) appliedTaskTemplates.delete(key);
  return noContent();
});
for (const kind of ['projekte', 'vorlagen']) {
  const handler: Handler = (req) => {
    const collection = kind === 'projekte' ? taskData.projects : taskData.templates;
    const current = collection.find((p) => p.id === Number(req.params.id));
    if (req.method === 'PUT' && (!current || current.etag !== req.json?.etag))
      return TASK_CONFLICT();
    const common = {
      id: current?.id ?? Math.max(0, ...collection.map((p) => p.id)) + 1,
      etag: newEtag(newId()),
      title: str(req.json?.title),
    };
    if (kind === 'projekte') {
      const value = { ...common, campflowId: str(req.json?.campflowId) };
      if (current) Object.assign(current, value);
      else taskData.projects.push(value);
    } else {
      const value = {
        ...common,
        ...validateTemplate(req.json),
      };
      if (current) Object.assign(current, value);
      else taskData.templates.push(value);
    }
    return noContent();
  };
  route('POST', `${TASK_BASE}/${kind}`, handler);
  route('PUT', `${TASK_BASE}/${kind}/:id`, handler);
}
route('POST', `${TASK_BASE}/checkliste`, (req) => {
  const template = taskData.templates.find((t) => t.id === req.json?.templateId);
  if (!template || template.etag !== req.json?.etag) return TASK_CONFLICT();
  const key = `${req.json?.projectId}:${template.id}`;
  if (appliedTaskTemplates.has(key)) return json({ count: 0 });
  appliedTaskTemplates.add(key);
  for (const item of template.items) {
    const date = new Date(`${str(req.json?.date)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - item.daysBefore);
    taskData.tasks.push({
      ...item,
      id: nextTaskId++,
      etag: newEtag(newId()),
      dueDate: date.toISOString().slice(0, 10),
      projectId: Number(req.json?.projectId),
      state: 'offen',
      sourceId: '',
      sourceVersion: '',
      quote: '',
    });
  }
  return json({ count: template.items.length });
});
route('POST', `${TASK_BASE}/protokolle/:id/erkennen`, (req) => {
  const protocol = protokolle.find((p) => p.id === req.params.id);
  if (!protocol) return notFound();
  if (protocol.etag !== req.json?.etag || protocol.changedSinceApproval) return TASK_CONFLICT();
  if (recognizedTaskProtocols.has(protocol.id)) return json({ count: 0 });
  recognizedTaskProtocols.add(protocol.id);
  taskData.tasks.push({
    id: nextTaskId++,
    etag: newEtag(newId()),
    title: 'Lagerküche planen',
    description: 'Plan für das Lager erstellen.',
    assignee: 'Alex',
    dueDate: null,
    projectId: null,
    state: 'vorschlag',
    sourceId: protocol.id,
    sourceVersion: 'mock-content-v1',
    quote: 'Alex plant die Lagerküche für die Winteraktion.',
    suggestedProjectTitle: 'Winteraktion',
  });
  return json({ count: 1 });
});
route('POST', `${TASK_BASE}/:id/zuordnung`, (req) => {
  const task = taskData.tasks.find((t) => t.id === Number(req.params.id));
  if (!task) return notFound();
  if (task.etag !== req.json?.etag || task.state !== 'vorschlag') return TASK_CONFLICT();
  return json({
    assignee:
      taggedTaskAssignee(task, [
        { name: 'Demo Leitung', login: PRINCIPAL.userDetails },
        { name: 'Alex', login: 'alex@example.test' },
      ]) ?? null,
    unavailable: false,
  });
});
route('POST', `${TASK_BASE}/:id/entscheidung`, (req) => {
  const task = taskData.tasks.find((t) => t.id === Number(req.params.id));
  if (!task) return notFound();
  if (task.etag !== req.json?.etag || task.state !== 'vorschlag') return TASK_CONFLICT();
  if (req.json?.action === 'annehmen') {
    const input = validateTask(req.json);
    let projectId = req.json?.projectId ?? null;
    const title = str(req.json?.newProjectTitle).trim();
    if (title && task.suggestedProjectTitle) {
      let project = taskData.projects.find(
        (p) => p.title.toLocaleLowerCase('de') === title.toLocaleLowerCase('de')
      );
      if (!project) {
        project = {
          id: Math.max(0, ...taskData.projects.map((p) => p.id)) + 1,
          title,
          campflowId: '',
          etag: newEtag(newId()),
        };
        taskData.projects.push(project);
      }
      projectId = project.id;
    }
    Object.assign(task, {
      ...input,
      projectId,
      suggestedProjectTitle: '',
      state: 'offen',
      etag: newEtag(newId()),
    });
  } else Object.assign(task, { state: 'abgelehnt', etag: newEtag(newId()) });
  return noContent();
});

// Approving minutes creates their tasks, as on the server
mockAufgabenHooks.create = (protokollId, eintraege) => {
  const known = new Set(taskData.projects.map((project) => project.id));
  for (const { aufgabe, punkt, projekt } of eintraege) {
    taskData.tasks.push({
      id: nextTaskId++,
      etag: newEtag(newId()),
      title: aufgabe.titel.trim().slice(0, 200),
      description: '',
      assignee: aufgabe.zustaendig[0]?.login || aufgabe.zustaendig[0]?.name || '',
      assignees: aufgabe.zustaendig.map(({ login, name }) => ({ login, name })),
      dueDate: aufgabe.faellig || null,
      projectId: projekt && known.has(projekt.id) ? projekt.id : null,
      state: 'offen',
      sourceId: '',
      sourceVersion: '',
      quote: '',
      protokollId,
      protokollPunkt: punkt,
    });
  }
  return eintraege.length;
};
