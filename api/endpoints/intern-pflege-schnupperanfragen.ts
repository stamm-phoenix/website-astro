import type { HttpRequest, InvocationContext } from '@azure/functions';
import { parseId } from '../lib/db';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  ok,
  pflegeHandler,
  readEtag,
  readIfMatch,
  readJsonBody,
  requireVersion,
} from '../lib/pflege-api';
import { withErrorHandling } from '../lib/response-utils';
import {
  schnupperAbgesagtMail,
  schnupperBestaetigtMail,
  sendSchnupperFamilienMail,
} from '../lib/schnupper-mails';
import type { SchnupperAntwortErgebnis, StaffSchnupperAnfrage } from '../lib/schnupper-model';
import {
  cancelSchnupperAnfrage,
  confirmSchnupperAnfrage,
  deleteSchnupperAnfrage,
  getSchnupperAnfragen,
  markSchnupperMail,
  purgeExpiredSchnupperAnfragen,
} from '../lib/schnupperanfragen';
import {
  validateSchnupperAbsage,
  validateSchnupperBestaetigung,
} from '../lib/validation/schnupper';

const AREA = 'schnupperanfragen';

/**
 * Sends the answer to the family and records whether it went out. The answer is saved before,
 * so a failed mail only changes the flag; the leader then writes to the family by hand.
 */
async function deliver(
  anfrage: StaffSchnupperAnfrage,
  context: InvocationContext
): Promise<SchnupperAntwortErgebnis> {
  const mail =
    anfrage.status === 'bestaetigt'
      ? schnupperBestaetigtMail(anfrage)
      : schnupperAbgesagtMail(anfrage);
  let mailSent = true;
  try {
    await sendSchnupperFamilienMail(anfrage, mail);
  } catch (error: unknown) {
    context.error('Sending the Schnupper answer failed', error);
    mailSent = false;
  }
  // Recording the flag changes the version, so the answer carries the one after it
  try {
    const current = await markSchnupperMail(anfrage.id, mailSent);
    if (current) return { anfrage: current, mailSent };
  } catch (error: unknown) {
    context.error('Recording the Schnupper mail state failed', error);
  }
  return { anfrage: { ...anfrage, antwortMail: mailSent }, mailSent };
}

/** GET: all requests; opening the module also deletes requests past their retention. */
export const SchnupperAnfragenCollectionEndpoint = pflegeHandler(
  AREA,
  async (request: HttpRequest) => {
    if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
    await purgeExpiredSchnupperAnfragen();
    return ok(await getSchnupperAnfragen());
  }
);

/** DELETE: removes a request in the loaded version; a concurrent change returns 409. */
export const SchnupperAnfrageItemEndpoint = pflegeHandler(AREA, async (request: HttpRequest) => {
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  if (request.method !== 'DELETE') return METHOD_NOT_ALLOWED;
  await deleteSchnupperAnfrage(id, requireVersion(readIfMatch(request)));
  return NO_CONTENT;
});

/** POST: confirms a date and mails it to the family. */
export const SchnupperAnfrageBestaetigenEndpoint = pflegeHandler(
  AREA,
  async (request: HttpRequest, context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const input = validateSchnupperBestaetigung(body);
    const anfrage = await confirmSchnupperAnfrage(
      id,
      input,
      requireVersion(readEtag(body)),
      principal.userDetails
    );
    return ok(await deliver(anfrage, context));
  }
);

/** POST: cancels the request and tells the family. */
export const SchnupperAnfrageAbsagenEndpoint = pflegeHandler(
  AREA,
  async (request: HttpRequest, context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const input = validateSchnupperAbsage(body);
    const anfrage = await cancelSchnupperAnfrage(
      id,
      input,
      requireVersion(readEtag(body)),
      principal.userDetails
    );
    return ok(await deliver(anfrage, context));
  }
);

export const SchnupperAnfragenCollection = withErrorHandling(SchnupperAnfragenCollectionEndpoint);
export const SchnupperAnfrageItem = withErrorHandling(SchnupperAnfrageItemEndpoint);
export const SchnupperAnfrageBestaetigen = withErrorHandling(SchnupperAnfrageBestaetigenEndpoint);
export const SchnupperAnfrageAbsagen = withErrorHandling(SchnupperAnfrageAbsagenEndpoint);
