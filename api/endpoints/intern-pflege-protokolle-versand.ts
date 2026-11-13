import { assertProtokollSize } from '../lib/protokoll-text';
import { protokollToText } from '../lib/protokoll-text';
import { updateProtokollMetadata, completeProtokollDelivery } from '../lib/protokoll-metadata';
import { findDrive, loadProtokoll } from '../lib/protokoll-source';
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { CONFIG } from '../lib/config';
import { CampflowError } from '../lib/campflow';
import {
  getSharePointDriveFileContent,
  getSharePointDriveItemPreviewUrl,
} from '../lib/sharepoint-data-access';
import type { ProtokollRecipient } from '../lib/protokolle';
import {
  audienceVersion,
  loadProtokollRecipients,
  protokollDeliveryAddresses,
} from '../lib/protokolle';
import { assertProtokollAttachmentSize, sendProtokollMail } from '../lib/protokoll-mails';
import { ValidationError } from '../lib/validation/errors';
import { validateProtokollVersand } from '../lib/validation/protokolle';
import { CONFLICT, NOT_FOUND, ok, readEtag, requireEtag } from '../lib/pflege-api';
import { mitEigenerAdresse } from '../lib/personen';
import {
  encodeContentDisposition,
  getErrorStatus,
  NO_STORE_HEADERS,
  readJsonBody,
} from '../lib/response-utils';
import { staffHandler } from '../lib/handler';
import { protokollGate } from '../lib/protokoll-gate';
import {
  NOT_CONFIGURED,
  SENDING_NOT_CONFIGURED,
  CHANGED,
  UNCERTAIN,
  CAMPFLOW_UNAVAILABLE,
  isValidId,
  protokollUrl,
} from '../lib/protokolle-http';

/** GET: the minutes converted to PDF by SharePoint. */
export const ProtokollPdf = staffHandler(
  'protokolle',
  async (request: HttpRequest) => {
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
        'Content-Type': /\.txt$/i.test(loaded.protokoll.fileName)
          ? 'text/plain'
          : 'application/pdf',
        'Content-Disposition': encodeContentDisposition(
          loaded.protokoll.fileName.replace(/\.docx$/i, '.pdf')
        ),
      },
      body: pdf,
    };
  },
  { gate: protokollGate }
);

/** GET: a short-lived URL that shows the minutes read-only in an iframe. */
export const ProtokollVorschau = staffHandler(
  'protokolle',
  async (request: HttpRequest) => {
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
  },
  { gate: protokollGate }
);

/**
 * POST `preview`: the recipients from CampFlow (with reasons) and a version of that list. POST
 * `send`: mails the approved minutes as PDF to that list, without the addresses in `excluded` and
 * with those in `extra`, if the list still matches the confirmed version.
 */
export const ProtokollVersand = staffHandler(
  'protokolle-versand',
  async (
    request: HttpRequest,
    context: InvocationContext,
    principal: ClientPrincipal
  ): Promise<HttpResponseInit> => {
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

    const etag = requireEtag(readEtag(body));
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
      const status = getErrorStatus(error);
      if (status !== undefined && status >= 400 && status < 500 && status !== 408) {
        await completeProtokollDelivery(driveId, id, attempt);
      }
      throw error;
    }
    await completeProtokollDelivery(driveId, id, attempt, delivery('sent'));
    return ok({ recipients: addresses.length });
  }
);

app.http('internPflegeProtokollPdf', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokolle/{id}/pdf',
  handler: ProtokollPdf,
});

app.http('internPflegeProtokollVorschau', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokolle/{id}/vorschau',
  handler: ProtokollVorschau,
});

app.http('internPflegeProtokollVersand', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokolle/{id}/versand',
  handler: ProtokollVersand,
});
