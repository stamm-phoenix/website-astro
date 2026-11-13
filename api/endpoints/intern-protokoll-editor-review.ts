import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { CONFIG } from '../lib/config';
import { RecordNotFoundError, parseId } from '../lib/db';
import { NOT_FOUND, ok, readEtag } from '../lib/pflege-api';
import { validateProtokollEditorReview } from '../lib/validation/protokoll-editor';
import type { ProtokollFreigabeResponse } from '../lib/protokoll-editor-model';
import {
  approveEditorProtokoll,
  editorProtokollPdf,
  rejectEditorReview,
  submitEditorReview,
} from '../lib/protokoll-editor-review';
import { sendProtokollRejectedMail } from '../lib/protokoll-mails';
import { getSiteUrl } from '../lib/site-url';
import { encodeContentDisposition, NO_STORE_HEADERS, readJsonBody } from '../lib/response-utils';
import { benachrichtigeErwaehnte } from '../lib/protokoll-erwaehnungen';
import { staffHandler } from '../lib/handler';
import { AREA, editorHandler } from '../lib/protokoll-editor-http';

/** The page of the minutes, linked from the mails. */
export function editorUrl(request: HttpRequest, id: number): string {
  return `${getSiteUrl(request)}/leitendenbereich/protokolle/protokoll?id=${id}`;
}

/**
 * GET: the PDF of the minutes. Approved minutes get the PDF filed in SharePoint, drafts and
 * minutes in review a fresh one marked as draft.
 */
export const GetEditorPdf = staffHandler(AREA, async (request) => {
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  let pdf: { fileName: string; content: Uint8Array };
  try {
    pdf = await editorProtokollPdf(id);
  } catch (error: unknown) {
    if (error instanceof RecordNotFoundError) return NOT_FOUND;
    throw error;
  }
  return {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      'Content-Type': 'application/pdf',
      'Content-Disposition': encodeContentDisposition(pdf.fileName),
    },
    body: pdf.content,
  };
});

/**
 * POST: a step of the review. `review` gives a draft to the review and `approve` files the PDF
 * and approves a draft or minutes in review (a draft only from the writing tab or while nobody
 * writes; one's own minutes only with `ownConfirmed`). `reject` sends minutes in review back
 * with a note that goes to the author by mail.
 */
export const EditorReview = editorHandler(async (id, request, context, principal) => {
  const body = await readJsonBody(request);
  const { action, token, ownConfirmed, note } = validateProtokollEditorReview(body);
  const etag = readEtag(body);
  let result: HttpResponseInit;
  if (action === 'review') {
    await submitEditorReview(id, { etag, token }, principal.userDetails);
    result = ok({});
  } else if (action === 'approve') {
    const freigabe = await approveEditorProtokoll(id, { etag, token, ownConfirmed }, principal);
    // The approval stands; the notes to the mentioned people are best effort
    let benachrichtigt = 0;
    try {
      benachrichtigt = await benachrichtigeErwaehnte(
        {
          inhalt: freigabe.inhalt,
          title: freigabe.title,
          date: freigabe.date,
          approvedBy: principal.userDetails,
          url: editorUrl(request, id),
        },
        (message, error) => context.warn(`${message} (Protokoll ${id})`, error ?? '')
      );
    } catch (error: unknown) {
      context.warn(`[protokoll-editor] Erwähnte von ${id} nicht benachrichtigt`, error);
    }
    const body: ProtokollFreigabeResponse = {
      fileName: freigabe.fileName,
      aufgaben: freigabe.aufgaben,
      benachrichtigt,
    };
    result = ok(body);
  } else {
    const rejected = await rejectEditorReview(id, { etag, note });
    let mailSent = false;
    if (CONFIG.protokolle.sender && rejected.createdBy.includes('@')) {
      try {
        await sendProtokollRejectedMail({
          to: rejected.createdBy,
          title: rejected.title,
          date: rejected.date,
          note: note.trim(),
          reviewer: principal.userDetails,
          url: editorUrl(request, id),
        });
        mailSent = true;
      } catch (error: unknown) {
        context.warn(`[protokoll-editor] Mail to the author of ${id} failed`, error);
      }
    }
    result = ok({ mailSent });
  }
  context.log(`[pflege] ${principal.userDetails} POST ${AREA} ${id} (${action})`);
  return result;
}, true);

app.http('internProtokollEditorPdf', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor/{id}/pdf',
  handler: GetEditorPdf,
});

app.http('internPflegeProtokollEditorReview', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor/{id}/review',
  handler: EditorReview,
});
