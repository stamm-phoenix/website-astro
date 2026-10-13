import type { HttpResponseInit } from '@azure/functions';
import { berlinDay } from './calendar-day';
import { ValidationError } from './pflege-validation';
import { CONFLICT, ok } from './pflege-api';
import { errorResponse } from './response-utils';
import { detectProtokollTasks, isTaskExtractionConfigured } from './protokoll-aufgaben';
import { findDrive, loadProtokoll } from './protokoll-source';
import type { ProtokollDriveItem, StaffProtokoll } from './protokolle';
import { docxContentVersion } from './protokoll-content-version';
import { getSharePointDriveFileContent } from './sharepoint-data-access';
import { getTaskDirectoryUsers } from './task-directory';
import type { TaskDirectoryUser } from './task-directory-types';
import { getTaskProjects, hasTaskRecognition, storeTaskSuggestions } from './aufgaben';
/** Fresh content check, including legacy approvals, using the resolver from #248. */
export async function taskSource(id: string): Promise<{
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
export async function recognizeTasks(
  id: string,
  etag: string | undefined,
  actor: string,
  warn: (message: string) => void
): Promise<HttpResponseInit> {
  if (!isTaskExtractionConfigured())
    throw new ValidationError({ form: 'Die Aufgabenerkennung ist nicht eingerichtet.' });
  const source = await taskSource(id);
  if (etag !== source.protokoll.etag) return CONFLICT;
  if (await hasTaskRecognition(id, source.version))
    return ok({ count: 0, assignmentUnavailable: false });
  const docx = await getSharePointDriveFileContent(source.driveId, id);
  const before = await loadProtokoll(source.driveId, id);
  if (
    !before ||
    before.item.cTag !== source.item.cTag ||
    before.protokoll.etag !== source.protokoll.etag ||
    docxContentVersion(docx) !== source.version
  )
    return CONFLICT;
  let assignmentUnavailable = false;
  let users: TaskDirectoryUser[] = [];
  try {
    users = await getTaskDirectoryUsers();
  } catch {
    assignmentUnavailable = true;
    warn('[aufgaben] Entra-Personenliste nicht verfügbar');
  }
  let items;
  try {
    items = await detectProtokollTasks(docx, source.protokoll.date, await getTaskProjects(), users);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    warn('[aufgaben] Aufgabenerkennung fehlgeschlagen');
    return errorResponse(
      502,
      'EXTRACTION_FAILED',
      'Die KI-Erkennung ist fehlgeschlagen. Bitte später erneut versuchen oder Aufgaben manuell anlegen.'
    );
  }
  // Past deadlines are historical protocol content, not new actionable suggestions.
  const today = berlinDay();
  items = items.filter((item) => !item.dueDate || item.dueDate >= today);
  const after = await taskSource(id);
  if (after.version !== source.version || after.protokoll.etag !== source.protokoll.etag)
    return CONFLICT;
  return ok({
    count: await storeTaskSuggestions(id, source.version, items, actor),
    assignmentUnavailable,
  });
}
