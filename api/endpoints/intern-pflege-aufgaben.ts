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
  getTask,
  getTaskProjects,
  getTasks,
  getTaskTemplates,
  saveTaskProject,
  saveTaskTemplate,
  storeTaskSuggestions,
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
import { detectProtokollTasks, isTaskExtractionConfigured } from '../lib/protokoll-aufgaben';
import { findDrive, loadProtokoll } from '../lib/protokoll-source';
import type { ProtokollDriveItem, StaffProtokoll } from '../lib/protokolle';
import { isProtokollReviewer } from '../lib/protokolle';
import { docxContentVersion } from '../lib/protokoll-content-version';
import { getSharePointDriveFileContent } from '../lib/sharepoint-data-access';

/** Fresh content check, including legacy approvals, using the resolver from #248. */
async function taskSource(id: string): Promise<{
  item: ProtokollDriveItem;
  protokoll: StaffProtokoll;
  driveId: string;
  version: string;
}> {
  if (!/^[A-Za-z0-9!_-]{1,100}$/.test(id))
    throw new ValidationError({ form: 'Ungültiges Protokoll.' });
  const driveId = await findDrive();
  if (!driveId)
    throw new ValidationError({ form: 'Die Protokollbibliothek ist nicht eingerichtet.' });
  const loaded = await loadProtokoll(driveId, id, 'current-version');
  if (
    !loaded ||
    !['Freigegeben', 'Verschickt', 'Archiv'].includes(loaded.protokoll.status) ||
    loaded.protokoll.changedSinceApproval ||
    !loaded.item.contentVersion
  )
    throw new ValidationError({
      form: 'Das Protokoll muss freigegeben und unverändert oder archiviert sein. Bitte erneut prüfen.',
    });
  return { ...loaded, driveId, version: loaded.item.contentVersion };
}
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
    if (!isTaskExtractionConfigured())
      throw new ValidationError({ form: 'Die Aufgabenerkennung ist nicht eingerichtet.' });
    const id = request.params.id ?? '';
    const body = await readJsonBody(request);
    const source = await taskSource(id);
    if (readEtag(body) !== source.protokoll.etag) return CONFLICT;
    const docx = await getSharePointDriveFileContent(source.driveId, id);
    const before = await loadProtokoll(source.driveId, id);
    if (
      !before ||
      before.item.cTag !== source.item.cTag ||
      before.protokoll.etag !== source.protokoll.etag ||
      docxContentVersion(docx) !== source.version
    )
      return CONFLICT;
    let items;
    try {
      items = await detectProtokollTasks(docx, source.protokoll.date);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      context.warn('[aufgaben] Aufgabenerkennung fehlgeschlagen');
      return errorResponse(
        502,
        'EXTRACTION_FAILED',
        'Die KI-Erkennung ist fehlgeschlagen. Bitte später erneut versuchen oder Aufgaben manuell anlegen.'
      );
    }
    const after = await taskSource(id);
    if (after.version !== source.version || after.protokoll.etag !== source.protokoll.etag)
      return CONFLICT;
    return ok({
      count: await storeTaskSuggestions(id, source.version, items, principal.userDetails),
    });
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
      principal.userDetails
    );
    return NO_CONTENT;
  }
);
export const AufgabenCollection = withErrorHandling(AufgabenCollectionEndpoint);
export const AufgabeItem = withErrorHandling(AufgabeItemEndpoint);
export const AufgabenProject = withErrorHandling(AufgabenProjectEndpoint);
export const AufgabenTemplate = withErrorHandling(AufgabenTemplateEndpoint);
export const AufgabenChecklist = withErrorHandling(AufgabenChecklistEndpoint);
export const AufgabenRecognize = withErrorHandling(AufgabenRecognizeEndpoint);
export const AufgabenDecision = withErrorHandling(AufgabenDecisionEndpoint);
