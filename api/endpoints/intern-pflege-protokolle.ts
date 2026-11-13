import { HELP_CONTACTS } from '../lib/help-contacts';
import {
  assertProtokollImport,
  createProtokollMetadata,
  updateProtokollMetadata,
} from '../lib/protokoll-metadata';
import { findDrive, loadProtokoll } from '../lib/protokoll-source';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { CONFIG } from '../lib/config';
import {
  createSharePointDriveFile,
  deleteSharePointDriveItem,
  getSharePointDriveFileContentByPath,
} from '../lib/sharepoint-data-access';
import type { ProtokollAction, ProtokollDriveItem } from '../lib/protokolle';
import {
  assertMayDeleteProtokoll,
  protokollFileName,
  protokollTransition,
  toStaffProtokoll,
} from '../lib/protokolle';
import { sendProtokollRejectedMail } from '../lib/protokoll-mails';
import { isTerminExtractionConfigured, serializeProtokollTermin } from '../lib/protokoll-termin';
import { protokollContentVersion } from '../lib/protokoll-content-version';
import { ValidationError } from '../lib/validation/errors';
import {
  readProtokollNote,
  validateProtokollAction,
  validateProtokollCreate,
} from '../lib/validation/protokolle';
import {
  CONFLICT,
  NO_CONTENT,
  NOT_FOUND,
  ok,
  readEtag,
  readIfMatch,
  requireEtag,
} from '../lib/pflege-api';
import { errorResponse, getErrorStatus, readJsonBody } from '../lib/response-utils';
import { staffHandler } from '../lib/handler';
import { protokollGate } from '../lib/protokoll-gate';
import {
  ACTIONS,
  NOT_CONFIGURED,
  FILE_EXISTS,
  isValidId,
  protokollUrl,
  describeTerminError,
  readTermin,
  listProtokolle,
} from '../lib/protokolle-http';

/** GET: all minutes with the role of the user; POST: new minutes from the template. */
export const ProtokolleCollection = staffHandler(
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
      const status = getErrorStatus(error);
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
      if (getErrorStatus(error) === 409) return FILE_EXISTS;
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
  },
  { gate: protokollGate }
);

/**
 * POST: changes the review state (`review`, `approve`, `reject`, `reopen`). After an approval
 * the next date is read from exactly the approved version, best effort. DELETE: moves minutes
 * that were not sent yet to the recycle bin.
 */
export const ProtokollItem = staffHandler(
  'protokolle',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    const id = request.params.id ?? '';
    if (!isValidId(id)) return NOT_FOUND;
    const driveId = await findDrive();
    if (!driveId) return NOT_CONFIGURED;

    if (request.method === 'DELETE') {
      const version = requireEtag(readIfMatch(request));
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
    const etag = requireEtag(readEtag(body));
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
          const version = requireEtag(approved.protokoll.etag);
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
  },
  { gate: protokollGate }
);

app.http('internPflegeProtokolle', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokolle',
  handler: ProtokolleCollection,
});

app.http('internPflegeProtokollItem', {
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokolle/{id}',
  handler: ProtokollItem,
});
