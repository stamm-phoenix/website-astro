import { assertProtokollSize } from './protokoll-text';
import { withProtokollMetadataList } from './protokoll-metadata';
import { loadProtokoll } from './protokoll-source';
import { editorAblageItemIds } from './protokoll-editor';
import { type HttpRequest, type InvocationContext } from '@azure/functions';
import { CONFIG } from './config';
import {
  getSharePointDriveFileContent,
  getSharePointDriveFolderChildren,
} from './sharepoint-data-access';
import type { ProtokollAction, ProtokollDriveItem } from './protokolle';
import { isProtokollFile, toStaffProtokoll } from './protokolle';
import type { ProtokollTermin as StoredTermin } from './protokoll-termin';
import {
  TerminExtractionError,
  TerminVersionConflictError,
  detectProtokollTermin,
  isTerminExtractionConfigured,
  terminWithoutSuggestion,
} from './protokoll-termin';
import { AzureOpenAiError } from './azure-openai';
import { DocxError } from './docx-text';
import { fileContentVersion, withProtokollContentVersions } from './protokoll-content-version';
import { getSiteUrl } from './site-url';
import { errorResponse, getErrorStatus } from './response-utils';

export const ACTIONS = [
  'review',
  'approve',
  'reject',
  'reopen',
] as const satisfies readonly ProtokollAction[];

export const NOT_CONFIGURED = errorResponse(
  503,
  'NOT_CONFIGURED',
  `Die Bibliothek „${CONFIG.protokolle.library}“ wurde in SharePoint nicht gefunden.`
);

export const SENDING_NOT_CONFIGURED = errorResponse(
  503,
  'NOT_CONFIGURED',
  'Für den Versand ist noch kein Absender eingerichtet.'
);

export const FILE_EXISTS = errorResponse(
  409,
  'EXISTS',
  'Für diesen Tag gibt es schon ein Protokoll mit diesem Titel.'
);

export const CHANGED = errorResponse(
  409,
  'CHANGED',
  'Das Protokoll wurde nach der Freigabe geändert. Bitte erneut zum Review geben.'
);

export const UNCERTAIN = errorResponse(
  409,
  'UNCERTAIN',
  'Der letzte Versand wurde gestartet, aber nicht bestätigt. Bitte im Postfach des Absenders prüfen, ob die Mail rausging, bevor du erneut sendest.'
);

export const CAMPFLOW_UNAVAILABLE = errorResponse(
  502,
  'CAMPFLOW_UNAVAILABLE',
  'Die Leitenden konnten nicht aus CampFlow geladen werden. Bitte versuche es später erneut.'
);

export function isValidId(id: string): boolean {
  return /^[A-Za-z0-9!_-]+$/.test(id);
}

export function protokollUrl(request: HttpRequest, id?: string): string {
  return `${getSiteUrl(request)}/leitendenbereich/protokolle/${id ? `#protokoll-${id}` : ''}`;
}

/** What may be logged about a failed detection: never the text of the minutes or the answer. */
export function describeTerminError(error: unknown): string {
  if (
    error instanceof AzureOpenAiError ||
    error instanceof TerminExtractionError ||
    error instanceof DocxError
  ) {
    return error.message;
  }
  const status = getErrorStatus(error);
  if (status !== undefined) return `Graph ${status}`;
  return error instanceof Error ? error.name : 'unknown error';
}

/**
 * Reads the next date from the file of the minutes, which must be the version `sourceVersion`.
 * Without a model the result is „nicht eingerichtet“. Download/model failures are stored as
 * „fehler“; version conflicts still abort detection before any text reaches the model.
 */
export async function readTermin(
  driveId: string,
  id: string,
  item: ProtokollDriveItem,
  sourceVersion: string,
  context: InvocationContext
): Promise<StoredTermin> {
  if (!isTerminExtractionConfigured()) {
    return terminWithoutSuggestion('nicht eingerichtet', sourceVersion);
  }
  try {
    assertProtokollSize(item.size);
    const docx = await getSharePointDriveFileContent(driveId, id);
    assertProtokollSize(docx.byteLength);
    // /content serves the current file. Check again before sending any text to the model.
    const current = await loadProtokoll(driveId, id);
    if (
      !current ||
      current.item.cTag !== item.cTag ||
      current.protokoll.etag !== toStaffProtokoll(item).etag
    ) {
      throw new TerminVersionConflictError();
    }
    if (
      (/^(docx-word|file)-sha256:/.test(sourceVersion)
        ? fileContentVersion(docx, item.name)
        : current.item.cTag) !== sourceVersion
    ) {
      throw new TerminVersionConflictError();
    }
    return await detectProtokollTermin(docx, {
      sessionDate: toStaffProtokoll(item).date,
      fileName: item.name,
      sourceVersion,
    });
  } catch (error: unknown) {
    if (error instanceof TerminVersionConflictError) throw error;
    context.warn(
      `[protokolle] Terminerkennung für ${id} fehlgeschlagen: ${describeTerminError(error)}`
    );
    return terminWithoutSuggestion('fehler', sourceVersion);
  }
}

/** The minutes of the folder; PDFs filed by the editor are listed with their minutes there. */
export async function listProtokolle(driveId: string): Promise<ProtokollDriveItem[]> {
  const [editorFiles, children] = await Promise.all([
    editorAblageItemIds(driveId),
    getSharePointDriveFolderChildren(driveId, CONFIG.protokolle.folderPath),
  ]);
  const files = (children as ProtokollDriveItem[]).filter(
    (item) => isProtokollFile(item, CONFIG.protokolle.folderPath) && !editorFiles.has(item.id)
  );
  return withProtokollContentVersions(driveId, await withProtokollMetadataList(driveId, files));
}
