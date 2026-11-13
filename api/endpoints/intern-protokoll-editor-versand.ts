import { app } from '@azure/functions';
import { CampflowError } from '../lib/campflow';
import { CONFIG } from '../lib/config';
import { parseId } from '../lib/db';
import { NOT_FOUND, ok, readEtag } from '../lib/pflege-api';
import { ValidationError } from '../lib/validation/errors';
import { validateProtokollVersand } from '../lib/validation/protokolle';
import {
  finishEditorVersand,
  loadEditorVersand,
  reserveEditorVersand,
} from '../lib/protokoll-editor-review';
import { assertProtokollAttachmentSize, sendProtokollMail } from '../lib/protokoll-mails';
import type { ProtokollRecipient } from '../lib/protokolle';
import {
  audienceVersion,
  loadProtokollRecipients,
  protokollDeliveryAddresses,
} from '../lib/protokolle';
import { getSharePointDriveFileContent } from '../lib/sharepoint-data-access';
import { getErrorStatus, readJsonBody } from '../lib/response-utils';
import { mitEigenerAdresse } from '../lib/personen';
import { staffHandler } from '../lib/handler';
import {
  SENDING_NOT_CONFIGURED,
  CAMPFLOW_UNAVAILABLE,
  withEditorErrors,
} from '../lib/protokoll-editor-http';
import { editorUrl } from './intern-protokoll-editor-review';

/**
 * POST `preview`: the recipients from CampFlow (with reasons) and a version of that list. POST
 * `send`: mails the filed PDF to that list, without the addresses in `excluded` and with those in
 * `extra`, if the list still matches the confirmed version.
 */
export const EditorVersand = staffHandler(
  'protokoll-editor-versand',
  async (request, context, principal) => {
    if (!CONFIG.protokolle.sender) return SENDING_NOT_CONFIGURED;
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    const body = await readJsonBody(request);
    const { action, retry } = validateProtokollVersand(body);

    return withEditorErrors(async () => {
      const quelle = await loadEditorVersand(id, retry);
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

      // Download before reserving, so a missing file leaves nothing to clean up
      let pdf: Uint8Array;
      try {
        pdf = await getSharePointDriveFileContent(quelle.pdf.driveId, quelle.pdf.itemId);
      } catch (error: unknown) {
        if (getErrorStatus(error) !== 404) throw error;
        throw new ValidationError({
          form: `Das PDF „${quelle.pdf.fileName}“ fehlt im Protokoll-Ordner. Bitte aus dem SharePoint-Papierkorb wiederherstellen.`,
        });
      }
      assertProtokollAttachmentSize(pdf.byteLength);
      const attempt = await reserveEditorVersand(
        id,
        { etag: readEtag(body), retry, recipients: addresses.length },
        principal.userDetails
      );
      try {
        await sendProtokollMail(addresses, {
          title: quelle.title,
          date: quelle.date,
          approvedBy: quelle.approvedBy,
          url: editorUrl(request, id),
          pdf: { name: quelle.pdf.fileName, contentType: 'application/pdf', content: pdf },
        });
      } catch (error: unknown) {
        // Graph refused the mail with a client error, so it did not go out. After a timeout or
        // a server error it may have, so the reservation stays.
        const status = getErrorStatus(error);
        if (status !== undefined && status >= 400 && status < 500 && status !== 408) {
          await finishEditorVersand(id, attempt, 'failed');
        }
        throw error;
      }
      await finishEditorVersand(id, attempt, 'sent');
      return ok({ recipients: addresses.length });
    });
  }
);

app.http('internPflegeProtokollEditorVersand', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor/{id}/versand',
  handler: EditorVersand,
});
