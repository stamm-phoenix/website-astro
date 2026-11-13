import type { HttpRequest, InvocationContext } from '@azure/functions';
import { parseId } from '../lib/db';
import { NOT_FOUND, NO_CONTENT, ok, readEtag, readIfMatch, requireEtag } from '../lib/pflege-api';
import { readJsonBody } from '../lib/response-utils';
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
import { staffHandler } from '../lib/handler';

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
  // Recording the flag changes the version, so the answer carries the one after it. A newer
  // answer of another leader keeps its own flag.
  try {
    const current = await markSchnupperMail(anfrage.id, anfrage.etag, mailSent);
    if (current) return { ...current, mailSent };
  } catch (error: unknown) {
    context.error('Recording the Schnupper mail state failed', error);
  }
  return { anfrage: { ...anfrage, antwortMail: mailSent }, mailSent };
}

/** GET: all requests; opening the module also deletes requests past their retention. */
export const SchnupperAnfragenCollectionEndpoint = staffHandler(AREA, async () => {
  await purgeExpiredSchnupperAnfragen();
  return ok(await getSchnupperAnfragen());
});

/** DELETE: removes a request in the loaded version; a concurrent change returns 409. */
export const SchnupperAnfrageItemEndpoint = staffHandler(AREA, async (request: HttpRequest) => {
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  await deleteSchnupperAnfrage(id, requireEtag(readIfMatch(request)));
  return NO_CONTENT;
});

/** POST: confirms a date and mails it to the family. */
export const SchnupperAnfrageBestaetigenEndpoint = staffHandler(
  AREA,
  async (request: HttpRequest, context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    const body = await readJsonBody(request);
    const input = validateSchnupperBestaetigung(body);
    const anfrage = await confirmSchnupperAnfrage(
      id,
      input,
      requireEtag(readEtag(body)),
      principal.userDetails
    );
    return ok(await deliver(anfrage, context));
  }
);

/** POST: cancels the request and tells the family. */
export const SchnupperAnfrageAbsagenEndpoint = staffHandler(
  AREA,
  async (request: HttpRequest, context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    const body = await readJsonBody(request);
    const input = validateSchnupperAbsage(body);
    const anfrage = await cancelSchnupperAnfrage(
      id,
      input,
      requireEtag(readEtag(body)),
      principal.userDetails
    );
    return ok(await deliver(anfrage, context));
  }
);
