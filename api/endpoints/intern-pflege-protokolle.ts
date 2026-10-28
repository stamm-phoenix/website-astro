import { HELP_CONTACTS } from '../lib/help-contacts';
import { assertProtokollSize } from '../lib/protokoll-text';
import { protokollToText } from '../lib/protokoll-text';
import {
  assertProtokollImport,
  createProtokollMetadata,
  updateProtokollMetadata,
  completeProtokollDelivery,
  withProtokollMetadataList,
} from '../lib/protokoll-metadata';
import { findDrive, loadProtokoll } from '../lib/protokoll-source';
import { editorAblageItemIds } from '../lib/protokoll-editor';
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { CONFIG } from '../lib/config';
import { CampflowError } from '../lib/campflow';
import {
  createSharePointDriveFile,
  deleteSharePointDriveItem,
  getGraphStatus,
  getSharePointDriveFileContent,
  getSharePointDriveFolderChildren,
  getSharePointDriveItemPreviewUrl,
  getSharePointDriveFileContentByPath,
} from '../lib/sharepoint-data-access';
import type { ProtokollAction, ProtokollDriveItem, ProtokollRecipient } from '../lib/protokolle';
import {
  assertMayDeleteProtokoll,
  audienceVersion,
  isProtokollFile,
  loadProtokollRecipients,
  protokollDeliveryAddresses,
  protokollFileName,
  protokollTransition,
  toStaffProtokoll,
} from '../lib/protokolle';
import {
  assertProtokollAttachmentSize,
  sendProtokollMail,
  sendProtokollRejectedMail,
} from '../lib/protokoll-mails';
import type { ProtokollTermin as StoredTermin } from '../lib/protokoll-termin';
import {
  TERMIN_ACTIONS,
  TerminExtractionError,
  TerminVersionConflictError,
  assertMayChangeTermin,
  decideTermin,
  detectProtokollTermin,
  isTerminExtractionConfigured,
  serializeProtokollTermin,
  terminWithoutSuggestion,
} from '../lib/protokoll-termin';
import { AzureOpenAiError } from '../lib/azure-openai';
import { DocxError } from '../lib/docx-text';
import {
  fileContentVersion,
  protokollContentVersion,
  withProtokollContentVersions,
} from '../lib/protokoll-content-version';
import { ValidationError } from '../lib/validation/errors';
import {
  readProtokollNote,
  validateProtokollAction,
  validateProtokollCreate,
  validateProtokollVersand,
} from '../lib/validation/protokolle';
import {
  CONFLICT,
  METHOD_NOT_ALLOWED,
  NO_CONTENT,
  NOT_FOUND,
  NO_STORE_HEADERS,
  ok,
  pflegeHandler,
  readEtag,
  readIfMatch,
  readJsonBody,
  requireVersion,
} from '../lib/pflege-api';
import { mitEigenerAdresse } from '../lib/personen';
import { getSiteUrl } from '../lib/site-url';
import { encodeContentDisposition, errorResponse, withErrorHandling } from '../lib/response-utils';

const ACTIONS = [
  'review',
  'approve',
  'reject',
  'reopen',
] as const satisfies readonly ProtokollAction[];

const NOT_CONFIGURED = errorResponse(
  503,
  'NOT_CONFIGURED',
  `Die Bibliothek „${CONFIG.protokolle.library}“ wurde in SharePoint nicht gefunden.`
);

const SENDING_NOT_CONFIGURED = errorResponse(
  503,
  'NOT_CONFIGURED',
  'Für den Versand ist noch kein Absender eingerichtet.'
);

const FILE_EXISTS = errorResponse(
  409,
  'EXISTS',
  'Für diesen Tag gibt es schon ein Protokoll mit diesem Titel.'
);

const CHANGED = errorResponse(
  409,
  'CHANGED',
  'Das Protokoll wurde nach der Freigabe geändert. Bitte erneut zum Review geben.'
);

const UNCERTAIN = errorResponse(
  409,
  'UNCERTAIN',
  'Der letzte Versand wurde gestartet, aber nicht bestätigt. Bitte im Postfach des Absenders prüfen, ob die Mail rausging, bevor du erneut sendest.'
);

const CAMPFLOW_UNAVAILABLE = errorResponse(
  502,
  'CAMPFLOW_UNAVAILABLE',
  'Die Leitenden konnten nicht aus CampFlow geladen werden. Bitte versuche es später erneut.'
);

function isValidId(id: string): boolean {
  return /^[A-Za-z0-9!_-]+$/.test(id);
}

function protokollUrl(request: HttpRequest, id?: string): string {
  return `${getSiteUrl(request)}/leitendenbereich/protokolle/${id ? `#protokoll-${id}` : ''}`;
}

/** What may be logged about a failed detection: never the text of the minutes or the answer. */
function describeTerminError(error: unknown): string {
  if (
    error instanceof AzureOpenAiError ||
    error instanceof TerminExtractionError ||
    error instanceof DocxError
  ) {
    return error.message;
  }
  const status = getGraphStatus(error);
  if (status !== undefined) return `Graph ${status}`;
  return error instanceof Error ? error.name : 'unknown error';
}

/**
 * Reads the next date from the file of the minutes, which must be the version `sourceVersion`.
 * Without a model the result is „nicht eingerichtet“. Download/model failures are stored as
 * „fehler“; version conflicts still abort detection before any text reaches the model.
 */
async function readTermin(
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
async function listProtokolle(driveId: string): Promise<ProtokollDriveItem[]> {
  const [editorFiles, children] = await Promise.all([
    editorAblageItemIds(driveId),
    getSharePointDriveFolderChildren(driveId, CONFIG.protokolle.folderPath),
  ]);
  const files = (children as ProtokollDriveItem[]).filter(
    (item) => isProtokollFile(item, CONFIG.protokolle.folderPath) && !editorFiles.has(item.id)
  );
  return withProtokollContentVersions(driveId, await withProtokollMetadataList(driveId, files));
}

/** GET: all minutes with the role of the user; POST: new minutes from the template. */
export const ProtokolleCollectionEndpoint = pflegeHandler(
  'protokolle',
  async (request: HttpRequest, _context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method === 'GET') {
      const driveId = await findDrive();
      const items = driveId ? (await listProtokolle(driveId)).map(toStaffProtokoll) : [];
      return ok({
        configured: driveId !== undefined,
        defaultTitle: CONFIG.protokolle.defaultTitle,
        sendingConfigured: CONFIG.protokolle.sender !== '',
        terminConfigured: isTerminExtractionConfigured(),
        login: principal.userDetails,
        items,
      });
    }
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const driveId = await findDrive();
    if (!driveId) return NOT_CONFIGURED;

    const { title, date } = validateProtokollCreate(await readJsonBody(request));

    await assertProtokollImport(driveId);
    let template: Uint8Array;
    try {
      template = await getSharePointDriveFileContentByPath(
        driveId,
        `${CONFIG.protokolle.folderPath}/${CONFIG.protokolle.templateFileName}`
      );
    } catch (error: unknown) {
      const status = getGraphStatus(error);
      if (status !== 403 && status !== 404) throw error;
      return errorResponse(
        503,
        'NOT_CONFIGURED',
        `Die Word-Vorlage „${CONFIG.protokolle.templateFileName}“ wurde im Ordner der Protokolle nicht gefunden. Es wurde kein Protokoll angelegt. Bitte an ${HELP_CONTACTS.technik} wenden.`
      );
    }

    let created: ProtokollDriveItem;
    try {
      created = (await createSharePointDriveFile(
        driveId,
        CONFIG.protokolle.folderPath,
        protokollFileName(date, title),
        template
      )) as ProtokollDriveItem;
    } catch (error: unknown) {
      if (getGraphStatus(error) === 409) return FILE_EXISTS;
      throw error;
    }
    try {
      await createProtokollMetadata(driveId, created.id, {
        Status: 'Entwurf',
        ErstelltVon: principal.userDetails,
      });
    } catch (error: unknown) {
      // Without a status the file would be listed as Archiv and block the name; remove it
      await deleteSharePointDriveItem(driveId, created.id).catch(() => undefined);
      throw error;
    }
    return ok({ id: created.id, webUrl: created.webUrl ?? '' }, 201);
  }
);

/**
 * POST: changes the review state (`review`, `approve`, `reject`, `reopen`). After an approval
 * the next date is read from exactly the approved version, best effort. DELETE: moves minutes
 * that were not sent yet to the recycle bin.
 */
export const ProtokollItemEndpoint = pflegeHandler(
  'protokolle',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method !== 'POST' && request.method !== 'DELETE') return METHOD_NOT_ALLOWED;
    const id = request.params.id ?? '';
    if (!isValidId(id)) return NOT_FOUND;
    const driveId = await findDrive();
    if (!driveId) return NOT_CONFIGURED;

    if (request.method === 'DELETE') {
      const version = requireVersion(readIfMatch(request));
      const current = await loadProtokoll(driveId, id);
      if (!current) return NOT_FOUND;
      if (current.protokoll.etag !== version) return CONFLICT;
      assertMayDeleteProtokoll(current.protokoll);
      // Goes to the recycle bin of the site, from where it can be restored
      await deleteSharePointDriveItem(driveId, id);
      return NO_CONTENT;
    }

    const body = await readJsonBody(request);
    const action: ProtokollAction = validateProtokollAction(body, ACTIONS);
    const etag = requireVersion(readEtag(body));
    const note = readProtokollNote(body);

    const loaded = await loadProtokoll(
      driveId,
      id,
      action === 'approve' ? 'current-version' : 'metadata'
    );
    if (!loaded) return NOT_FOUND;
    if (loaded.protokoll.etag !== etag) return CONFLICT;
    if (action === 'approve' && !protokollContentVersion(loaded.item)) {
      throw new ValidationError({
        form: 'Die Protokolldatei konnte nicht geprüft werden. Bitte neu laden und die Freigabe erneut versuchen.',
      });
    }

    const fields = protokollTransition(loaded.protokoll, action, principal, {
      cTag: protokollContentVersion(loaded.item),
      note,
      now: new Date(),
      ownConfirmed: body?.ownConfirmed === true,
    });
    await updateProtokollMetadata(driveId, id, { ...fields }, etag);

    if (action === 'approve') {
      // The approval stands; reading the next date must never undo or fail it
      const sourceVersion = fields.FreigabeVersion ?? '';
      try {
        const approved = await loadProtokoll(driveId, id, 'stored-version');
        if (
          approved?.protokoll.status === 'Freigegeben' &&
          approved.protokoll.approvedAt === fields.FreigegebenAm &&
          protokollContentVersion(approved.item, sourceVersion) === sourceVersion &&
          approved.item.metadata?.fields.Termin === loaded.item.metadata?.fields.Termin
        ) {
          const version = requireVersion(approved.protokoll.etag);
          const termin = await readTermin(driveId, id, approved.item, sourceVersion, context);
          // Someone may have decided, reopened or sent the minutes while the model ran.
          await updateProtokollMetadata(
            driveId,
            id,
            { Termin: serializeProtokollTermin(termin) },
            version
          );
        }
      } catch (error: unknown) {
        context.warn(
          `[protokolle] Termin von ${id} konnte nicht gespeichert werden: ${describeTerminError(error)}`
        );
      }
    }

    let mailSent = false;
    const author = loaded.protokoll.createdBy;
    if (action === 'reject' && CONFIG.protokolle.sender && author.includes('@')) {
      try {
        await sendProtokollRejectedMail({
          to: author,
          title: loaded.protokoll.title,
          date: loaded.protokoll.date,
          note,
          reviewer: principal.userDetails,
          url: protokollUrl(request, id),
        });
        mailSent = true;
      } catch (error: unknown) {
        context.warn(`[protokolle] Mail to the author of ${id} failed`, error);
      }
    }
    return ok({ mailSent });
  }
);

/**
 * POST: the next meeting of approved or sent minutes. `erkennen` reads it from
 * the approved file again and resets the decision; `bestaetigen` stores the date (from the
 * suggestion, corrected or entered by hand); `ablehnen` means there is no next date.
 */
export const ProtokollTerminEndpoint = pflegeHandler(
  'protokolle',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const id = request.params.id ?? '';
    if (!isValidId(id)) return NOT_FOUND;
    const driveId = await findDrive();
    if (!driveId) return NOT_CONFIGURED;

    const body = await readJsonBody(request);
    const action = validateProtokollAction(body, TERMIN_ACTIONS);
    const etag = requireVersion(readEtag(body));

    const loaded = await loadProtokoll(driveId, id, 'current-version');
    if (!loaded) return NOT_FOUND;
    const { item, protokoll } = loaded;
    if (protokoll.etag !== etag) return CONFLICT;
    const sourceVersion = protokollContentVersion(item);
    if (!sourceVersion) {
      throw new ValidationError({
        form: 'Die Protokolldatei konnte nicht geprüft werden. Bitte neu laden und erneut versuchen.',
      });
    }
    // Archived files have no approval; the suggestion refers to the file as it is now
    const approvedVersion =
      protokoll.status === 'Archiv'
        ? sourceVersion
        : (item.metadata?.fields.FreigabeVersion ?? item.listItem?.fields?.FreigabeVersion ?? '');
    assertMayChangeTermin(protokoll, action, {
      currentVersion: protokollContentVersion(item, approvedVersion),
      approvedVersion,
    });

    const migrateApproval = protokoll.status !== 'Archiv' && sourceVersion !== approvedVersion;

    const termin =
      action === 'erkennen'
        ? await readTermin(driveId, id, item, sourceVersion, context)
        : decideTermin(
            {
              ...(protokoll.termin ?? {
                ...terminWithoutSuggestion('nicht ausgefuehrt', sourceVersion),
                extractedAt: '',
              }),
              sourceVersion,
            },
            action,
            {
              by: principal.userDetails,
              now: new Date(),
              sessionDate: protokoll.date,
              input: { date: body?.date, time: body?.time, place: body?.place },
            }
          );
    // The combined version covers workflow changes and external file edits.
    await updateProtokollMetadata(
      driveId,
      id,
      {
        Termin: serializeProtokollTermin(termin),
        ...(migrateApproval ? { FreigabeVersion: sourceVersion } : {}),
      },
      etag
    );
    return ok({ termin });
  }
);

/** GET: the minutes converted to PDF by SharePoint. */
export const ProtokollPdfEndpoint = pflegeHandler('protokolle', async (request: HttpRequest) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
  const id = request.params.id ?? '';
  if (!isValidId(id)) return NOT_FOUND;
  const driveId = await findDrive();
  if (!driveId) return NOT_CONFIGURED;

  const loaded = await loadProtokoll(driveId, id);
  if (!loaded) return NOT_FOUND;
  assertProtokollSize(loaded.item.size);
  const pdf = await getSharePointDriveFileContent(
    driveId,
    id,
    /\.docx$/i.test(loaded.protokoll.fileName) ? 'pdf' : undefined
  );
  assertProtokollSize(pdf.byteLength);
  return {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      'Content-Type': /\.txt$/i.test(loaded.protokoll.fileName) ? 'text/plain' : 'application/pdf',
      'Content-Disposition': encodeContentDisposition(
        loaded.protokoll.fileName.replace(/\.docx$/i, '.pdf')
      ),
    },
    body: pdf,
  };
});

/** GET: a short-lived URL that shows the minutes read-only in an iframe. */
export const ProtokollVorschauEndpoint = pflegeHandler(
  'protokolle',
  async (request: HttpRequest) => {
    if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
    const id = request.params.id ?? '';
    if (!isValidId(id)) return NOT_FOUND;
    const driveId = await findDrive();
    if (!driveId) return NOT_CONFIGURED;

    const loaded = await loadProtokoll(driveId, id);
    if (!loaded) return NOT_FOUND;
    if (/\.txt$/i.test(loaded.protokoll.fileName)) {
      assertProtokollSize(loaded.item.size);
      const bytes = await getSharePointDriveFileContent(driveId, id);
      assertProtokollSize(bytes.byteLength);
      return ok({ text: await protokollToText(bytes, loaded.protokoll.fileName) });
    }
    return ok({ url: await getSharePointDriveItemPreviewUrl(driveId, id) });
  }
);

/**
 * POST `preview`: the recipients from CampFlow (with reasons) and a version of that list. POST
 * `send`: mails the approved minutes as PDF to that list, without the addresses in `excluded` and
 * with those in `extra`, if the list still matches the confirmed version.
 */
export const ProtokollVersandEndpoint = pflegeHandler(
  'protokolle-versand',
  async (
    request: HttpRequest,
    context: InvocationContext,
    principal: ClientPrincipal
  ): Promise<HttpResponseInit> => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    if (!CONFIG.protokolle.sender) return SENDING_NOT_CONFIGURED;
    const id = request.params.id ?? '';
    if (!isValidId(id)) return NOT_FOUND;
    const driveId = await findDrive();
    if (!driveId) return NOT_CONFIGURED;

    const body = await readJsonBody(request);
    const { action, retry } = validateProtokollVersand(body);

    const loaded = await loadProtokoll(driveId, id, 'stored-version');
    if (!loaded) return NOT_FOUND;
    const { protokoll } = loaded;
    if (protokoll.status !== 'Freigegeben') {
      throw new ValidationError({ form: 'Nur freigegebene Protokolle können verschickt werden.' });
    }
    if (protokoll.changedSinceApproval) return CHANGED;
    if (protokoll.delivery?.state === 'attempted' && !retry) return UNCERTAIN;

    let recipients: ProtokollRecipient[];
    try {
      recipients = await loadProtokollRecipients();
    } catch (error: unknown) {
      if (!(error instanceof CampflowError)) throw error;
      context.error(error);
      return CAMPFLOW_UNAVAILABLE;
    }
    const version = audienceVersion(recipients);
    if (action === 'preview') {
      return ok({
        recipients: recipients.length,
        version,
        list: await mitEigenerAdresse(principal.userDetails, recipients),
      });
    }

    const etag = requireVersion(readEtag(body));
    if (protokoll.etag !== etag) return CONFLICT;
    if (body?.version !== version) {
      throw new ValidationError({
        form: 'Die Empfänger*innen in CampFlow haben sich geändert. Bitte prüf die Liste und bestätige sie erneut.',
      });
    }
    // Taken out or added by hand in the dialog, for this delivery only
    const addresses = protokollDeliveryAddresses(recipients, body?.excluded, body?.extra);
    if (addresses.length === 0) {
      throw new ValidationError({
        form: 'Es ist niemand ausgewählt. Wähle mindestens eine Person aus oder trag eine Adresse ein.',
      });
    }

    // Convert before reserving, so a failed conversion leaves nothing to clean up
    assertProtokollSize(loaded.item.size);
    const pdf = await getSharePointDriveFileContent(
      driveId,
      id,
      /\.docx$/i.test(loaded.protokoll.fileName) ? 'pdf' : undefined
    );
    assertProtokollAttachmentSize(pdf.byteLength);
    const delivery = (state: 'attempted' | 'sent'): string =>
      JSON.stringify({
        state,
        recipients: addresses.length,
        at: new Date().toISOString(),
        by: principal.userDetails,
      });
    // Reserve first: the etag stops a second tab or instance from sending the same minutes
    const attempt = delivery('attempted');
    await updateProtokollMetadata(driveId, id, { Versand: attempt }, etag);

    try {
      await sendProtokollMail(addresses, {
        title: protokoll.title,
        date: protokoll.date,
        approvedBy: protokoll.approvedBy,
        url: protokollUrl(request, id),
        pdf: {
          name: protokoll.fileName.replace(/\.docx$/i, '.pdf'),
          contentType: /\.txt$/i.test(protokoll.fileName) ? 'text/plain' : 'application/pdf',
          content: pdf,
        },
      });
    } catch (error: unknown) {
      // Graph refused the mail with a client error, so it did not go out. After a timeout or a
      // server error it may have, so the reservation stays.
      const status = getGraphStatus(error);
      if (status !== undefined && status >= 400 && status < 500 && status !== 408) {
        await completeProtokollDelivery(driveId, id, attempt);
      }
      throw error;
    }
    await completeProtokollDelivery(driveId, id, attempt, delivery('sent'));
    return ok({ recipients: addresses.length });
  }
);

export const ProtokolleCollection = withErrorHandling(ProtokolleCollectionEndpoint);
export const ProtokollItem = withErrorHandling(ProtokollItemEndpoint);
export const ProtokollPdf = withErrorHandling(ProtokollPdfEndpoint);
export const ProtokollTermin = withErrorHandling(ProtokollTerminEndpoint);
export const ProtokollVersand = withErrorHandling(ProtokollVersandEndpoint);
export const ProtokollVorschau = withErrorHandling(ProtokollVorschauEndpoint);
