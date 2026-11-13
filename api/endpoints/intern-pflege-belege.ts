import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import {
  changesDetails,
  isBelegReviewer,
  isUploader as isOwner,
  mayDeleteBeleg,
  mayEditBeleg,
  seesAllBelege,
} from '../lib/beleg-rechte';
import { parseId } from '../lib/db';
import { validateBeleg } from '../lib/validation/beleg';
import { isPhotos, readPhotos } from '../lib/validation/beleg-upload';
import { NO_CONTENT, NOT_FOUND, ok, readEtag, readIfMatch, requireEtag } from '../lib/pflege-api';
import { readJsonBody } from '../lib/response-utils';
import type { StaffBeleg } from '../lib/beleg-list';
import {
  createBeleg,
  deleteBeleg,
  getBeleg,
  getBelege,
  toStaffBeleg,
  updateBeleg,
} from '../lib/beleg-list';
import { staffHandler } from '../lib/handler';
import {
  ACCEPTED,
  FORBIDDEN,
  beforeDeadline,
  cleanName,
  directoryUsers,
  isAuslageOf,
  mailRejection,
  notifyKasse,
  ownNames,
  startCheck,
  todayInBerlin,
} from '../lib/belege-http';

/**
 * GET: all receipts, newest first; POST: submit a receipt with its photo and tell the Kasse
 * about it by mail.
 */
export const BelegeCollection = staffHandler(
  'belege',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    const deadline = Date.now() + 40_000;
    if (request.method === 'GET') {
      const users = await directoryUsers();
      const names = await ownNames(principal, users);
      const byLogin = new Map(users.map((user) => [user.login.toLowerCase(), user.name]));
      // The browser does not know the user's names, so the server marks their Auslagen; it also
      // names who submitted a receipt and says whether the user may still change it
      const describe = (beleg: StaffBeleg): StaffBeleg => {
        const submitter = byLogin.get(beleg.submittedBy.toLowerCase());
        return {
          ...beleg,
          ...(isAuslageOf(beleg, names) ? { mine: true as const } : {}),
          ...(submitter ? { submittedByName: cleanName(submitter) } : {}),
          editable: !beleg.readOnly && mayEditBeleg(beleg, principal),
        };
      };
      if (seesAllBelege(principal)) return ok((await getBelege()).map(toStaffBeleg).map(describe));
      // Own receipts, and to look at the ones someone else submitted for the user's Auslage
      // The database narrows the list, so other people's receipts are never read
      const belege = (await getBelege({ submittedBy: principal.userDetails, auslageNames: names }))
        .map(toStaffBeleg)
        .filter((beleg) => isOwner(beleg, principal) || isAuslageOf(beleg, names))
        .map((beleg) => (isOwner(beleg, principal) ? beleg : { ...beleg, readOnly: true as const }))
        .map(describe);
      return ok(belege);
    }

    const body = await readJsonBody(request);
    const input = validateBeleg(body, todayInBerlin());
    // New receipts always start unchecked
    input.status = 'Eingereicht';
    input.reviewNote = '';

    const photos = readPhotos(body);
    if (!isPhotos(photos)) return photos;

    // The model takes a few seconds; let it work while the photo is stored
    const check = startCheck(photos, context);
    const id = await createBeleg(input, principal.userDetails, photos, check);
    await beforeDeadline(
      notifyKasse(input, false, principal, request, context, deadline),
      deadline,
      undefined
    );
    return ok({ id }, 201);
  }
);

/**
 * PATCH: update details and review state (optimistic locking via etag); answers with the new
 * `etag`. Rejecting a receipt mails the reason to the uploader; `mailed` says whether that
 * worked. A receipt its uploader resubmits is mailed to the Kasse again. DELETE: remove.
 */
export const BelegItem = staffHandler(
  'belege',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    const deadline = Date.now() + 40_000;
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;

    if (request.method === 'DELETE') {
      const etag = requireEtag(readIfMatch(request));
      const beleg = await getBeleg(id);
      if (!beleg) return NOT_FOUND;
      if (!mayDeleteBeleg(beleg, principal)) return FORBIDDEN;
      await deleteBeleg(id, etag);
      return NO_CONTENT;
    }

    const body = await readJsonBody(request);
    const etag = requireEtag(readEtag(body));
    const previous = await getBeleg(id);
    if (!previous) return NOT_FOUND;
    const reviewer = isBelegReviewer(principal);
    const editor = mayEditBeleg(previous, principal);
    if (!reviewer && !editor)
      return previous.status === 'Angenommen' && isOwner(previous, principal)
        ? ACCEPTED
        : FORBIDDEN;
    const input = validateBeleg(body, todayInBerlin(), previous.aktion);
    // An accepted receipt keeps its details; the Kasse may still change its decision
    if (!editor && changesDetails(previous, input)) return ACCEPTED;
    if (!reviewer) {
      // Others correct the details and resubmit a rejected receipt, nothing more
      const resubmit = previous.status === 'Abgelehnt' && input.status === 'Eingereicht';
      if (input.status !== previous.status && !resubmit) return FORBIDDEN;
      input.reviewNote = previous.reviewNote;
    }
    // The version this change wrote, so a follow-up (e.g. the transfer to CampFlow) never takes
    // someone else's later change for it
    const saved = await updateBeleg(id, input, etag, principal.userDetails);

    // A resubmitted receipt goes to the Kasse again; the Kasse resetting a decision mails nobody
    if (previous.status === 'Abgelehnt' && input.status === 'Eingereicht' && !reviewer) {
      await beforeDeadline(
        notifyKasse(input, true, principal, request, context, deadline),
        deadline,
        undefined
      );
    }
    const rejected = input.status === 'Abgelehnt' && previous.status !== 'Abgelehnt';
    if (!rejected) return ok({ mailed: false, etag: saved });
    return ok({
      // Graph or its sign-in may hang; the decision is saved, so answer in time without the mail
      mailed: await beforeDeadline(
        mailRejection(previous, input, principal, request, context, deadline),
        deadline,
        false
      ),
      etag: saved,
    });
  }
);

app.http('internPflegeBelege', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege',
  handler: BelegeCollection,
});

app.http('internPflegeBelegItem', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/{id}',
  handler: BelegItem,
});
