import { assertProtokollSize } from '../lib/protokoll-text';
import { protokollToText } from '../lib/protokoll-text';
import {
  assertProtokollImport,
  createProtokollMetadata,
  updateProtokollMetadata,
  withProtokollMetadata,
} from '../lib/protokoll-metadata';
import { findDrive, loadProtokoll } from '../lib/protokoll-source';
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { CONFIG } from '../lib/config';
import type { CampflowPerson } from '../lib/campflow';
import { CampflowError, campflowGetAll } from '../lib/campflow';
import {
  createSharePointDriveFile,
  deleteSharePointDriveItem,
  getGraphStatus,
  getSharePointDriveFileContent,
  getSharePointDriveFolderChildren,
  getSharePointDriveItemPreviewUrl,
  getSharedFileContent,
} from '../lib/sharepoint-data-access';
import { MAX_MAIL_ATTACHMENT_BYTES } from '../lib/mail';
import type { ProtokollAction, ProtokollDriveItem } from '../lib/protokolle';
import {
  assertMayDeleteProtokoll,
  audienceVersion,
  isProtokollFile,
  isProtokollReviewer,
  protokollFileName,
  protokollRecipients,
  protokollTransition,
  toStaffProtokoll,
} from '../lib/protokolle';
import { sendProtokollMail, sendProtokollRejectedMail } from '../lib/protokoll-mails';
import type { ProtokollTermin as StoredTermin, TerminAction } from '../lib/protokoll-termin';
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
import { ValidationError, checkFileName } from '../lib/pflege-validation';
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
import { getSiteUrl } from '../lib/site-url';
import { encodeContentDisposition, errorResponse, withErrorHandling } from '../lib/response-utils';

const ACTIONS: ProtokollAction[] = ['review', 'approve', 'reject', 'reopen'];

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

const FORBIDDEN = errorResponse(
  403,
  'FORBIDDEN',
  'Verschicken dürfen nur die eingetragenen Reviewer*innen.'
);

const CAMPFLOW_UNAVAILABLE = errorResponse(
  502,
  'CAMPFLOW_UNAVAILABLE',
  'Die Leitenden konnten nicht aus CampFlow geladen werden. Bitte versuche es später erneut.'
);

function isValidId(id: string): boolean {
  return /^[A-Za-z0-9!_-]+$/.test(id);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function protokollUrl(request: HttpRequest, id?: string): string {
  return `${getSiteUrl(request)}/leitendenbereich/protokolle/${id ? `#protokoll-${id}` : ''}`;
}

/** Current leaders from the CampFlow member list. */
async function loadRecipients(): Promise<string[]> {
  const persons = await campflowGetAll<CampflowPerson>('/lists/member/persons');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
  return protokollRecipients(persons, today, CONFIG.protokolle.campflowGroups);
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

/** GET: all minutes with the role of the user; POST: new minutes from the template. */
export const ProtokolleCollectionEndpoint = pflegeHandler(
  'protokolle',
  async (request: HttpRequest, _context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method === 'GET') {
      const driveId = await findDrive();
      const items = driveId
        ? (
            await withProtokollContentVersions(
              driveId,
              await Promise.all(
                (
                  (await getSharePointDriveFolderChildren(
                    driveId,
                    CONFIG.protokolle.folderPath
                  )) as ProtokollDriveItem[]
                )
                  .filter((item) => isProtokollFile(item, CONFIG.protokolle.folderPath))
                  .map((item) => withProtokollMetadata(driveId, item))
              )
            )
          ).map(toStaffProtokoll)
        : [];
      return ok({
        configured: driveId !== undefined,
        defaultTitle: CONFIG.protokolle.defaultTitle,
        sendingConfigured: CONFIG.protokolle.sender !== '',
        terminConfigured: isTerminExtractionConfigured(),
        reviewer: isProtokollReviewer(principal),
        login: principal.userDetails,
        items,
      });
    }
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const driveId = await findDrive();
    if (!driveId) return NOT_CONFIGURED;

    const body = await readJsonBody(request);
    const title = typeof body?.title === 'string' ? body.title.trim().replace(/\s+/g, ' ') : '';
    const date = typeof body?.date === 'string' ? body.date : '';
    const errors: Record<string, string> = {};
    if (!title || title.length > 80) {
      errors.title = 'Bitte einen Titel mit höchstens 80 Zeichen angeben.';
    } else if (checkFileName(protokollFileName('2000-01-01', title))) {
      errors.title = 'Der Titel darf keines dieser Zeichen enthalten: " * : < > ? / \\ | # %';
    }
    if (!isValidDate(date)) errors.date = 'Bitte das Datum der Sitzung angeben.';
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);

    await assertProtokollImport(driveId);
    let template: Uint8Array;
    try {
      template = await getSharedFileContent(CONFIG.protokolle.templateUrl);
    } catch (error: unknown) {
      const status = getGraphStatus(error);
      if (status !== 403 && status !== 404) throw error;
      return errorResponse(
        503,
        'NOT_CONFIGURED',
        'Die Word-Vorlage wurde nicht gefunden. Bitte den Link in der Konfiguration prüfen.'
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
      assertMayDeleteProtokoll(current.protokoll, principal);
      // Goes to the recycle bin of the site, from where it can be restored
      await deleteSharePointDriveItem(driveId, id);
      return NO_CONTENT;
    }

    const body = await readJsonBody(request);
    const action = body?.action as ProtokollAction;
    if (!ACTIONS.includes(action)) throw new ValidationError({ form: 'Unbekannte Aktion.' });
    const etag = requireVersion(readEtag(body));
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : '';

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
          // A reviewer may have decided, reopened or sent the minutes while the model ran.
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
 * POST: the next meeting of approved or sent minutes, for reviewers. `erkennen` reads it from
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
    const action = body?.action as TerminAction;
    if (!TERMIN_ACTIONS.includes(action)) throw new ValidationError({ form: 'Unbekannte Aktion.' });
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
      reviewer: isProtokollReviewer(principal),
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
      return ok({
        text: await protokollToText(
          await getSharePointDriveFileContent(driveId, id),
          loaded.protokoll.fileName
        ),
      });
    }
    return ok({ url: await getSharePointDriveItemPreviewUrl(driveId, id) });
  }
);

/**
 * POST `preview`: number of recipients and a version of that list. POST `send`: mails the
 * approved minutes as PDF to all leaders, if the list still matches the confirmed version.
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
    if (!isProtokollReviewer(principal)) return FORBIDDEN;
    const id = request.params.id ?? '';
    if (!isValidId(id)) return NOT_FOUND;
    const driveId = await findDrive();
    if (!driveId) return NOT_CONFIGURED;

    const body = await readJsonBody(request);
    const action = body?.action;
    if (action !== 'preview' && action !== 'send') {
      throw new ValidationError({ form: 'Unbekannte Aktion.' });
    }

    const loaded = await loadProtokoll(driveId, id, 'stored-version');
    if (!loaded) return NOT_FOUND;
    const { protokoll } = loaded;
    if (protokoll.status !== 'Freigegeben') {
      throw new ValidationError({ form: 'Nur freigegebene Protokolle können verschickt werden.' });
    }
    if (protokoll.changedSinceApproval) return CHANGED;
    if (protokoll.delivery?.state === 'attempted' && body?.retry !== true) return UNCERTAIN;

    let recipients: string[];
    try {
      recipients = await loadRecipients();
    } catch (error: unknown) {
      if (!(error instanceof CampflowError)) throw error;
      context.error(error);
      return CAMPFLOW_UNAVAILABLE;
    }
    const version = audienceVersion(recipients);
    if (action === 'preview') return ok({ recipients: recipients.length, version });

    const etag = requireVersion(readEtag(body));
    if (protokoll.etag !== etag) return CONFLICT;
    if (body?.version !== version) {
      throw new ValidationError({
        form: 'Die Leitenden in CampFlow haben sich geändert. Bitte die Anzahl erneut bestätigen.',
      });
    }
    if (recipients.length === 0) {
      throw new ValidationError({
        form: 'In CampFlow wurden keine Leitenden mit E-Mail gefunden.',
      });
    }

    // Convert before reserving, so a failed conversion leaves nothing to clean up
    assertProtokollSize(loaded.item.size);
    const pdf = await getSharePointDriveFileContent(
      driveId,
      id,
      /\.docx$/i.test(loaded.protokoll.fileName) ? 'pdf' : undefined
    );
    const delivery = (state: 'attempted' | 'sent'): string =>
      JSON.stringify({
        state,
        recipients: recipients.length,
        at: new Date().toISOString(),
        by: principal.userDetails,
      });
    // Reserve first: the etag stops a second tab or instance from sending the same minutes
    const reserved = await updateProtokollMetadata(
      driveId,
      id,
      { Versand: delivery('attempted') },
      etag
    );

    try {
      await sendProtokollMail(recipients, {
        title: protokoll.title,
        date: protokoll.date,
        approvedBy: protokoll.approvedBy,
        url: protokollUrl(request, id),
        pdf:
          pdf.byteLength <= MAX_MAIL_ATTACHMENT_BYTES
            ? {
                name: protokoll.fileName.replace(/\.docx$/i, '.pdf'),
                contentType: /\.txt$/i.test(protokoll.fileName) ? 'text/plain' : 'application/pdf',
                content: pdf,
              }
            : undefined,
      });
    } catch (error: unknown) {
      // Graph refused the mail with a client error, so it did not go out. After a timeout or a
      // server error it may have, so the reservation stays.
      const status = getGraphStatus(error);
      if (status !== undefined && status >= 400 && status < 500 && status !== 408) {
        await updateProtokollMetadata(driveId, id, { Versand: '' }, reserved, true);
      }
      throw error;
    }
    await updateProtokollMetadata(
      driveId,
      id,
      {
        Status: 'Verschickt',
        Versand: delivery('sent'),
      },
      reserved,
      true
    );
    return ok({ recipients: recipients.length });
  }
);

export const ProtokolleCollection = withErrorHandling(ProtokolleCollectionEndpoint);
export const ProtokollItem = withErrorHandling(ProtokollItemEndpoint);
export const ProtokollPdf = withErrorHandling(ProtokollPdfEndpoint);
export const ProtokollTermin = withErrorHandling(ProtokollTerminEndpoint);
export const ProtokollVersand = withErrorHandling(ProtokollVersandEndpoint);
export const ProtokollVorschau = withErrorHandling(ProtokollVorschauEndpoint);
