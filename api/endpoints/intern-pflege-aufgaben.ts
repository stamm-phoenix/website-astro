import { taskSource, recognizeTasks } from '../lib/aufgaben-erkennung';
import {
  taskDate,
  taskId,
  taskText,
  validateTask,
  validateTemplate,
} from '../lib/aufgaben-validation';
import {
  applyTaskTemplate,
  createTask,
  decideTaskSuggestion,
  deleteTask,
  deleteTaskProject,
  getTask,
  getTaskProjects,
  getTasks,
  getTaskTemplates,
  saveTaskProject,
  saveTaskTemplate,
  updateTask,
} from '../lib/aufgaben';
import { parseId } from '../lib/db';
import {
  CONFLICT,
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  ok,
  pflegeHandler,
  readEtag,
  readIfMatch,
  readJsonBody,
} from '../lib/pflege-api';
import { ValidationError } from '../lib/pflege-validation';
import { withErrorHandling, errorResponse } from '../lib/response-utils';
import { isTaskExtractionConfigured } from '../lib/protokoll-aufgaben';
import { isProtokollReviewer } from '../lib/protokolle';
import { getSharePointSiteUsers } from '../lib/sharepoint-rest';
import { taggedTaskAssignee } from '../lib/aufgaben-zuordnung';

/** Offer local site people to every authenticated staff member without blocking manual entry. */
export const AufgabenUsersEndpoint = pflegeHandler(
  'aufgaben-benutzer',
  async (request, context) => {
    if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
    try {
      const users = [
        ...new Map((await getSharePointSiteUsers()).map((user) => [user.login, user])).values(),
      ].sort((a, b) => a.name.localeCompare(b.name, 'de'));
      return ok({ users, unavailable: false });
    } catch {
      context.warn('[aufgaben] Personenvorschläge nicht verfügbar');
      return ok({ users: [], unavailable: true });
    }
  }
);
export const AufgabenCollectionEndpoint = pflegeHandler(
  'aufgaben',
  async (request, _context, principal) => {
    if (request.method === 'GET') {
      const [tasks, projects, templates] = await Promise.all([
        getTasks(),
        getTaskProjects(),
        getTaskTemplates(),
      ]);
      return ok({
        tasks,
        projects,
        templates,
        login: principal.userDetails,
        reviewer: isProtokollReviewer(principal),
        extractionConfigured: isTaskExtractionConfigured(),
      });
    }
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    await createTask(validateTask(await readJsonBody(request)), principal.userDetails);
    return NO_CONTENT;
  }
);
export const AufgabeItemEndpoint = pflegeHandler(
  'aufgaben',
  async (request, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (!id) return NOT_FOUND;
    if (request.method === 'DELETE') await deleteTask(id, readIfMatch(request));
    else if (request.method === 'PUT') {
      const body = await readJsonBody(request);
      if (typeof body?.done !== 'boolean')
        throw new ValidationError({ done: 'Bitte den Erledigt-Status angeben.' });
      await updateTask(id, validateTask(body), body.done, readEtag(body), principal.userDetails);
    } else return METHOD_NOT_ALLOWED;
    return NO_CONTENT;
  }
);
export const AufgabenProjectEndpoint = pflegeHandler(
  'aufgaben-projekte',
  async (request, _context, principal) => {
    if (request.method === 'DELETE') {
      const id = parseId(request.params.id ?? '');
      if (!id) return NOT_FOUND;
      await deleteTaskProject(id, readIfMatch(request), principal.userDetails);
      return NO_CONTENT;
    }
    if (!['POST', 'PUT'].includes(request.method)) return METHOD_NOT_ALLOWED;
    const id = request.method === 'PUT' ? parseId(request.params.id ?? '') : undefined;
    if (request.method === 'PUT' && !id) return NOT_FOUND;
    const body = await readJsonBody(request);
    await saveTaskProject(
      taskText(body?.title, 'title', 200, true),
      taskText(body?.campflowId, 'campflowId', 100),
      principal.userDetails,
      id,
      readEtag(body)
    );
    return NO_CONTENT;
  }
);
export const AufgabenTemplateEndpoint = pflegeHandler(
  'aufgaben-vorlagen',
  async (request, _context, principal) => {
    if (!['POST', 'PUT'].includes(request.method)) return METHOD_NOT_ALLOWED;
    const id = request.method === 'PUT' ? parseId(request.params.id ?? '') : undefined;
    if (request.method === 'PUT' && !id) return NOT_FOUND;
    const body = await readJsonBody(request);
    await saveTaskTemplate(validateTemplate(body), principal.userDetails, id, readEtag(body));
    return NO_CONTENT;
  }
);
export const AufgabenChecklistEndpoint = pflegeHandler(
  'aufgaben-checklisten',
  async (request, _context, principal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const count = await applyTaskTemplate(
      taskId(body?.projectId),
      taskId(body?.templateId, 'templateId'),
      taskDate(body?.date, true)!,
      readEtag(body),
      principal.userDetails
    );
    return ok({ count });
  }
);
const REVIEW_REQUIRED = errorResponse(
  403,
  'FORBIDDEN',
  'Aufgabenvorschläge dürfen nur Reviewende erkennen, annehmen oder ablehnen.'
);
export const AufgabenRecognizeEndpoint = pflegeHandler(
  'aufgaben-erkennen',
  async (request, context, principal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    if (!isProtokollReviewer(principal)) return REVIEW_REQUIRED;
    const body = await readJsonBody(request);
    return recognizeTasks(
      request.params.id ?? '',
      readEtag(body),
      principal.userDetails,
      (message) => context.warn(message)
    );
  }
);
export const AufgabenDecisionEndpoint = pflegeHandler(
  'aufgaben-entscheidung',
  async (request, _context, principal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    if (!isProtokollReviewer(principal)) return REVIEW_REQUIRED;
    const id = parseId(request.params.id ?? '');
    if (!id) return NOT_FOUND;
    const task = await getTask(id);
    if (!task) return NOT_FOUND;
    const body = await readJsonBody(request);
    if (body?.action !== 'annehmen' && body?.action !== 'ablehnen')
      throw new ValidationError({ form: 'Unbekannte Entscheidung.' });
    const accept = body.action === 'annehmen';
    const newProjectTitle =
      accept && body.newProjectTitle !== undefined
        ? taskText(body.newProjectTitle, 'newProjectTitle', 200, true)
        : '';
    if (newProjectTitle && !task.suggestedProjectTitle)
      throw new ValidationError({
        newProjectTitle: 'Diese Aufgabe enthält keinen neuen Projektvorschlag.',
      });
    if (accept) {
      const source = await taskSource(task.sourceId);
      if (source.version !== task.sourceVersion)
        return errorResponse(
          409,
          'SOURCE_CHANGED',
          'Das Quellprotokoll wurde geändert. Bitte diesen Vorschlag ablehnen und die aktuelle Fassung erneut erkennen lassen.'
        );
    }
    await decideTaskSuggestion(
      id,
      accept ? validateTask(body) : task,
      accept,
      readEtag(body),
      principal.userDetails,
      newProjectTitle || undefined
    );
    return NO_CONTENT;
  }
);
/** Resolve tags in existing proposals without changing stored data or loading the source document. */
export const AufgabenAssignmentEndpoint = pflegeHandler(
  'aufgaben-zuordnung',
  async (request, context, principal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    if (!isProtokollReviewer(principal)) return REVIEW_REQUIRED;
    const id = parseId(request.params.id ?? '');
    if (!id) return NOT_FOUND;
    const task = await getTask(id);
    if (!task) return NOT_FOUND;
    const body = await readJsonBody(request);
    if (readEtag(body) !== task.etag || task.state !== 'vorschlag') return CONFLICT;
    if (!task.assignee || !task.quote.includes('@'))
      return ok({ assignee: null, unavailable: false });
    try {
      return ok({
        assignee: taggedTaskAssignee(task, await getSharePointSiteUsers()) ?? null,
        unavailable: false,
      });
    } catch {
      context.warn('[aufgaben] Login-Zuordnung nicht verfügbar');
      return ok({ assignee: null, unavailable: true });
    }
  }
);
export const AufgabenCollection = withErrorHandling(AufgabenCollectionEndpoint);
export const AufgabenAssignment = withErrorHandling(AufgabenAssignmentEndpoint);
export const AufgabeItem = withErrorHandling(AufgabeItemEndpoint);
export const AufgabenProject = withErrorHandling(AufgabenProjectEndpoint);
export const AufgabenTemplate = withErrorHandling(AufgabenTemplateEndpoint);
export const AufgabenChecklist = withErrorHandling(AufgabenChecklistEndpoint);
export const AufgabenRecognize = withErrorHandling(AufgabenRecognizeEndpoint);
export const AufgabenDecision = withErrorHandling(AufgabenDecisionEndpoint);

export const AufgabenUsers = withErrorHandling(AufgabenUsersEndpoint);
