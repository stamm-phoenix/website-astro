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
  getSharePointDriveFolderChildrenWithFields,
  getSharePointDriveIdByName,
  getSharePointDriveItemPreviewUrl,
  getSharePointDriveItemWithFields,
  getSharedFileContent,
  updateSharePointDriveItemFields,
} from '../lib/sharepoint-data-access';
import { MAX_MAIL_ATTACHMENT_BYTES } from '../lib/mail';
import type { ProtokollAction, ProtokollDriveItem, StaffProtokoll } from '../lib/protokolle';
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
  assertMayChangeTermin,
  decideTermin,
  detectProtokollTermin,
  isTerminExtractionConfigured,
  serializeProtokollTermin,
  terminWithoutSuggestion,
} from '../lib/protokoll-termin';
import { AzureOpenAiError } from '../lib/azure-openai';
import { DocxError } from '../lib/docx-text';
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

/** The library of the minutes, or undefined if the site has no such library. */
async function findDrive(): Promise<string | undefined> {
  return CONFIG.protokolle.library
    ? getSharePointDriveIdByName(CONFIG.protokolle.library)
    : undefined;
}

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

async function loadProtokoll(
  driveId: string,
  id: string
): Promise<{ item: ProtokollDriveItem; protokoll: StaffProtokoll } | undefined> {
  const raw = (await getSharePointDriveItemWithFields(driveId, id)) as
    ProtokollDriveItem | undefined;
  // Other files of the library are not touched, even with a valid ID
  if (!raw || !isProtokollFile(raw, CONFIG.protokolle.folderPath)) return undefined;
  return { item: raw, protokoll: toStaffProtokoll(raw) };
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
 * Never throws: without a model the result is „nicht eingerichtet“, any failure (download,
 * daily limit, timeout, model) is stored as „fehler“, so a reviewer can retry or enter it.
 */
async function readTermin(
  driveId: string,
  id: string,
  protokoll: StaffProtokoll,
  sourceVersion: string,
  context: InvocationContext
): Promise<StoredTermin> {
  if (!isTerminExtractionConfigured()) {
    return terminWithoutSuggestion('nicht eingerichtet', sourceVersion);
  }
  try {
    const docx = await getSharePointDriveFileContent(driveId, id);
    return await detectProtokollTermin(docx, { sessionDate: protokoll.date, sourceVersion });
  } catch (error: unknown) {
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
            (await getSharePointDriveFolderChildrenWithFields(
              driveId,
              CONFIG.protokolle.folderPath
            )) as ProtokollDriveItem[]
          )
            .filter((item) => isProtokollFile(item, CONFIG.protokolle.folderPath))
            .map(toStaffProtokoll)
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
      await updateSharePointDriveItemFields(driveId, created.id, {
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

    const loaded = await loadProtokoll(driveId, id);
    if (!loaded) return NOT_FOUND;
    if (loaded.protokoll.etag !== etag) return CONFLICT;

    const fields = protokollTransition(loaded.protokoll, action, principal, {
      cTag: loaded.item.cTag ?? '',
      note,
      now: new Date(),
    });
    await updateSharePointDriveItemFields(driveId, id, { ...fields }, etag);

    if (action === 'approve') {
      // The approval stands; reading the next date must never undo or fail it
      const sourceVersion = fields.FreigabeVersion ?? '';
      const termin = await readTermin(driveId, id, loaded.protokoll, sourceVersion, context);
      try {
        await updateSharePointDriveItemFields(driveId, id, {
          Termin: serializeProtokollTermin(termin),
        });
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

    const loaded = await loadProtokoll(driveId, id);
    if (!loaded) return NOT_FOUND;
    const { item, protokoll } = loaded;
    if (protokoll.etag !== etag) return CONFLICT;
    // Archived files have no approval; the suggestion refers to the file as it is now
    const approvedVersion =
      protokoll.status === 'Archiv' ? (item.cTag ?? '') : (item.listItem?.fields?.FreigabeVersion ?? '');
    assertMayChangeTermin(protokoll, action, {
      reviewer: isProtokollReviewer(principal),
      currentVersion: item.cTag ?? '',
      approvedVersion,
    });

    const termin =
      action === 'erkennen'
        ? await readTermin(driveId, id, protokoll, approvedVersion, context)
        : decideTermin(protokoll.termin, action, {
            by: principal.userDetails,
            now: new Date(),
            sessionDate: protokoll.date,
            input: { date: body?.date, time: body?.time, place: body?.place },
          });
    // The etag also catches changes made while the model was reading
    await updateSharePointDriveItemFields(
      driveId,
      id,
      { Termin: serializeProtokollTermin(termin) },
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
  const pdf = await getSharePointDriveFileContent(driveId, id, 'pdf');
  return {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      'Content-Type': 'application/pdf',
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

    const loaded = await loadProtokoll(driveId, id);
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
    const pdf = await getSharePointDriveFileContent(driveId, id, 'pdf');
    const delivery = (state: 'attempted' | 'sent'): string =>
      JSON.stringify({
        state,
        recipients: recipients.length,
        at: new Date().toISOString(),
        by: principal.userDetails,
      });
    // Reserve first: the etag stops a second tab or instance from sending the same minutes
    await updateSharePointDriveItemFields(driveId, id, { Versand: delivery('attempted') }, etag);

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
                contentType: 'application/pdf',
                content: pdf,
              }
            : undefined,
      });
    } catch (error: unknown) {
      // Graph refused the mail with a client error, so it did not go out. After a timeout or a
      // server error it may have, so the reservation stays.
      const status = getGraphStatus(error);
      if (status !== undefined && status >= 400 && status < 500) {
        await updateSharePointDriveItemFields(driveId, id, { Versand: '' });
      }
      throw error;
    }
    await updateSharePointDriveItemFields(driveId, id, {
      Status: 'Verschickt',
      Versand: delivery('sent'),
    });
    return ok({ recipients: recipients.length });
  }
);

export const ProtokolleCollection = withErrorHandling(ProtokolleCollectionEndpoint);
export const ProtokollItem = withErrorHandling(ProtokollItemEndpoint);
export const ProtokollPdf = withErrorHandling(ProtokollPdfEndpoint);
export const ProtokollTermin = withErrorHandling(ProtokollTerminEndpoint);
export const ProtokollVersand = withErrorHandling(ProtokollVersandEndpoint);
export const ProtokollVorschau = withErrorHandling(ProtokollVorschauEndpoint);
