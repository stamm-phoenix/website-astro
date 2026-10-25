import type { HttpRequest, InvocationContext } from '@azure/functions';
import { validateAbstimmung } from '../lib/abstimmung-model';
import { ABSTIMMUNG_MAIL_TIMEOUT_MS, abstimmungMail } from '../lib/abstimmung-mails';
import {
  AbstimmungClosedError,
  AbstimmungForbiddenError,
  abstimmungPersonalLink,
  countAbstimmungErinnerungen,
  createAbstimmung,
  deleteAbstimmung,
  getAbstimmungDetail,
  getAbstimmungKopf,
  getAbstimmungMailStand,
  listAbstimmungen,
  queueAbstimmungEinladungen,
  queueAbstimmungErinnerungen,
  sendNextAbstimmungMail,
  setAbstimmungGeschlossen,
  updateAbstimmung,
  voteAsStaff,
} from '../lib/abstimmungen';
import type { AbstimmungKopf, AbstimmungMail, AbstimmungPerson } from '../lib/abstimmungen';
import { CampflowError, campflowGetAll } from '../lib/campflow';
import type { CampflowPerson } from '../lib/campflow';
import { CONFIG } from '../lib/config';
import { RecordNotFoundError, parseId } from '../lib/db';
import { loadFotoPersonen } from '../lib/foto-benachrichtigung';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  ok,
  pflegeHandler,
  readEtag,
  readIfMatch,
  readJsonBody,
} from '../lib/pflege-api';
import type { PflegeHandler } from '../lib/pflege-api';
import { ValidationError } from '../lib/pflege-validation';
import { eigeneAdresse, mitEigenerAdresse } from '../lib/personen';
import {
  audienceVersion,
  protokollDeliveryAddresses,
  protokollRecipients,
} from '../lib/protokolle';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { getSiteUrl } from '../lib/site-url';
import type { ClientPrincipal } from '../lib/staff-auth';
import { getPrincipalFirstName } from '../lib/staff-auth';
import { getTaskDirectoryUsers } from '../lib/task-directory';

const AREA = 'abstimmungen';
/** Mails one request sends; the page asks again until none are left. */
const MAILS_PER_STEP = 5;
/**
 * No mail is started later than this into a request, so even a mail that takes its whole time
 * limit ends well before the 45 seconds of Static Web Apps.
 */
const STEP_BUDGET_MS = 30_000;

const FORBIDDEN = errorResponse(
  403,
  'FORBIDDEN',
  'Nur die Person, die die Abstimmung angelegt hat, kann sie ändern oder Mails dazu verschicken.'
);
const CLOSED = errorResponse(
  409,
  'CLOSED',
  'Diese Abstimmung ist beendet. Öffne sie wieder, um abzustimmen oder einzuladen.'
);
const CAMPFLOW_UNAVAILABLE = errorResponse(
  502,
  'CAMPFLOW_UNAVAILABLE',
  'Die Leitenden konnten nicht aus CampFlow geladen werden, es wurde niemand eingeladen. Prüfe deine Internetverbindung und versuche es noch einmal.'
);
const MAIL_FAILED = errorResponse(
  502,
  'MAIL_FAILED',
  'Eine Mail konnte nicht verschickt werden. Die übrigen warten noch. Versuche es später noch einmal oder schreib an admin@stamm-phoenix.de.'
);

/** The module's own refusals; the other errors go to `pflegeHandler`. */
function abstimmungHandler(handler: PflegeHandler): PflegeHandler {
  return async (request, context, principal) => {
    try {
      return await handler(request, context, principal);
    } catch (error: unknown) {
      if (error instanceof AbstimmungForbiddenError) return FORBIDDEN;
      if (error instanceof AbstimmungClosedError) return CLOSED;
      throw error;
    }
  };
}

/** Login and the addresses an invitation to the logged-in person may have gone to. */
async function identity(principal: ClientPrincipal): Promise<Omit<AbstimmungPerson, 'name'>> {
  const login = principal.userDetails.trim().toLowerCase();
  const linked = await eigeneAdresse(login);
  return {
    login,
    adressen: [...new Set([login, linked.email].filter(Boolean))],
    // A family address belongs to the others too; their invitation must still go out
    adresse: linked.email && !linked.geteilt ? linked.email : login,
  };
}

/** `identity` with the full name from the Entra group, else the first name of the login. */
async function person(principal: ClientPrincipal): Promise<AbstimmungPerson> {
  const [ids, users] = await Promise.all([
    identity(principal),
    getTaskDirectoryUsers().catch(() => []),
  ]);
  const name =
    users.find((user) => user.login.toLowerCase() === ids.login)?.name ||
    getPrincipalFirstName(principal);
  return { ...ids, name };
}

function routeId(request: HttpRequest): number | undefined {
  return parseId(request.params.id ?? '');
}

/** The Abstimmung, if the logged-in person manages it; only the organizer does. */
async function organizerKopf(id: number, principal: ClientPrincipal): Promise<AbstimmungKopf> {
  const kopf = await getAbstimmungKopf(id);
  if (!kopf) throw new RecordNotFoundError();
  if (kopf.erstellt_von !== principal.userDetails.trim().toLowerCase()) {
    throw new AbstimmungForbiddenError();
  }
  return kopf;
}

/** GET: all Abstimmungen with the own answer. POST: a new one by the logged-in person. */
export const AbstimmungenCollectionEndpoint = pflegeHandler(
  AREA,
  abstimmungHandler(async (request, _context, principal) => {
    if (request.method === 'GET') return ok(await listAbstimmungen(await person(principal)));
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const input = validateAbstimmung(await readJsonBody(request));
    return ok({ id: await createAbstimmung(input, await person(principal)) }, 201);
  })
);

/**
 * GET: one Abstimmung with the own answer; the organizer also gets the shared link and the
 * invitations. PATCH `{ etag, geschlossen }` ends or reopens it, PATCH with the form fields
 * changes it. DELETE (If-Match) deletes it. Changes only by the organizer.
 */
export const AbstimmungItemEndpoint = pflegeHandler(
  AREA,
  abstimmungHandler(async (request, _context, principal) => {
    const id = routeId(request);
    if (id === undefined) return NOT_FOUND;
    const login = principal.userDetails.trim().toLowerCase();
    if (request.method === 'GET') {
      // With the name: an invitation a family member answered under it is not the own one
      const detail = await getAbstimmungDetail(id, await person(principal), getSiteUrl(request));
      return detail ? ok(detail) : NOT_FOUND;
    }
    if (request.method === 'DELETE') {
      await deleteAbstimmung(id, readIfMatch(request), login);
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    if (body && typeof body.geschlossen === 'boolean' && body.titel === undefined) {
      await setAbstimmungGeschlossen(id, readEtag(body), body.geschlossen, login);
      return NO_CONTENT;
    }
    await updateAbstimmung(id, readEtag(body), validateAbstimmung(body), login);
    return NO_CONTENT;
  })
);

/** PUT `{ gewaehlt }`: the answer of the logged-in person; replaces an earlier one. */
export const AbstimmungStimmeEndpoint = pflegeHandler(
  AREA,
  abstimmungHandler(async (request, _context, principal) => {
    const id = routeId(request);
    if (id === undefined) return NOT_FOUND;
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    await voteAsStaff(id, await person(principal), body?.gewaehlt);
    return NO_CONTENT;
  })
);

/**
 * The CampFlow member list, read fresh so the confirmed version sees changes made in between,
 * and the people of the module „Personen“; a seam for the tests.
 */
export const abstimmungQuellen = {
  members: (): Promise<CampflowPerson[]> => campflowGetAll<CampflowPerson>('/lists/member/persons'),
  personen: loadFotoPersonen,
};

/**
 * Invitations by mail, like the delivery of the minutes:
 * - `{ action: 'preview' }`: the leaders and members with the label from CampFlow (with
 *   reasons), a version of that list, the people of the module „Personen“ to add by hand and
 *   the addresses invited already (`eingeladen`).
 * - `{ action: 'send', version, excluded?, extra? }`: queues an invitation for each address of
 *   that list without `excluded` and with `extra` that has none yet, if the list still matches
 *   the confirmed version. The mails go out through `…/mails`.
 */
export const AbstimmungEinladungEndpoint = pflegeHandler(
  AREA,
  abstimmungHandler(async (request, context, principal) => {
    const id = routeId(request);
    if (id === undefined) return NOT_FOUND;
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const kopf = await organizerKopf(id, principal);
    if (kopf.geschlossen_am) return CLOSED;
    const body = await readJsonBody(request);
    const action = body?.action;
    if (action !== 'preview' && action !== 'send') {
      throw new ValidationError({ form: 'Unbekannte Aktion.' });
    }
    let members: CampflowPerson[];
    try {
      members = await abstimmungQuellen.members();
    } catch (error: unknown) {
      if (!(error instanceof CampflowError)) throw error;
      context.error(error);
      return CAMPFLOW_UNAVAILABLE;
    }
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(
      new Date()
    );
    const recipients = protokollRecipients(
      members,
      today,
      CONFIG.abstimmungen.campflowGroups,
      CONFIG.abstimmungen.campflowLabels
    );
    const version = audienceVersion(recipients);
    const personen = await abstimmungQuellen.personen(members);
    if (action === 'preview') {
      const detail = await getAbstimmungDetail(id, await identity(principal), getSiteUrl(request));
      return ok({
        recipients: recipients.length,
        version,
        list: await mitEigenerAdresse(principal.userDetails, recipients),
        personen,
        eingeladen: (detail?.teilnahmen ?? []).map((t) => t.email).filter(Boolean),
      });
    }
    if (body?.version !== version) {
      throw new ValidationError({
        form: 'Die Leitenden in CampFlow haben sich geändert. Bitte prüf die Liste und bestätige sie erneut.',
      });
    }
    const addresses = protokollDeliveryAddresses(recipients, body?.excluded, body?.extra);
    if (addresses.length === 0) {
      throw new ValidationError({
        form: 'Es ist niemand ausgewählt. Wähle mindestens eine Person aus oder trag eine Adresse ein.',
      });
    }
    const names = new Map<string, string>();
    for (const entry of personen) names.set(entry.email, entry.name);
    for (const entry of recipients) if (entry.name) names.set(entry.email, entry.name);
    // Several CampFlow persons with one address, e.g. a family: the list joins their names
    const familien = new Set(
      recipients.filter((entry) => entry.name.includes(', ')).map((entry) => entry.email)
    );
    const result = await queueAbstimmungEinladungen(
      id,
      principal.userDetails.trim().toLowerCase(),
      addresses.map((email) => ({
        email,
        name: names.get(email) ?? '',
        familie: familien.has(email),
      }))
    );
    return ok({ ...result, ...(await getAbstimmungMailStand(id)) });
  })
);

/**
 * Reminder to everyone invited who has not answered.
 * - `{ action: 'preview' }`: how many that are.
 * - `{ action: 'send' }`: queues the reminders; they go out through `…/mails`.
 */
export const AbstimmungErinnerungEndpoint = pflegeHandler(
  AREA,
  abstimmungHandler(async (request, _context, principal) => {
    const id = routeId(request);
    if (id === undefined) return NOT_FOUND;
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const kopf = await organizerKopf(id, principal);
    if (kopf.geschlossen_am) return CLOSED;
    const body = await readJsonBody(request);
    if (body?.action === 'preview') return ok({ personen: await countAbstimmungErinnerungen(id) });
    if (body?.action !== 'send') throw new ValidationError({ form: 'Unbekannte Aktion.' });
    const personen = await queueAbstimmungErinnerungen(
      id,
      principal.userDetails.trim().toLowerCase()
    );
    return ok({ personen, ...(await getAbstimmungMailStand(id)) });
  })
);

/**
 * POST: sends the next few queued mails and returns how many are left. Each mail is reserved
 * before it is sent, so two open pages never send one twice; a mail whose result is unclear
 * is not sent again.
 */
export const AbstimmungMailsEndpoint = pflegeHandler(
  AREA,
  abstimmungHandler(async (request, context: InvocationContext, principal) => {
    const id = routeId(request);
    if (id === undefined) return NOT_FOUND;
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const kopf = await organizerKopf(id, principal);
    // Queued mails wait while it is ended; reopening sends them
    if (kopf.geschlossen_am) return CLOSED;
    const siteUrl = getSiteUrl(request);
    const started = Date.now();
    for (let sent = 0; sent < MAILS_PER_STEP; sent++) {
      if (Date.now() - started + ABSTIMMUNG_MAIL_TIMEOUT_MS > STEP_BUDGET_MS) break;
      let failed: AbstimmungMail | undefined;
      try {
        const ergebnis = await sendNextAbstimmungMail(id, async (mail) => {
          failed = mail;
          await abstimmungMail.send(mail.email, {
            art: mail.art,
            name: mail.name,
            familie: mail.familie,
            titel: kopf.titel,
            beschreibung: kopf.beschreibung,
            organisatorName: kopf.erstellt_von_name,
            organisatorLogin: kopf.erstellt_von,
            url: abstimmungPersonalLink(siteUrl, mail.token),
          });
          failed = undefined;
        });
        if (ergebnis === 'beendet') return CLOSED;
        if (ergebnis === 'keine') break;
      } catch (error: unknown) {
        if (!failed) throw error;
        context.error(`[abstimmungen] Mail ${failed.art} for Abstimmung ${id} failed`, error);
        return MAIL_FAILED;
      }
    }
    return ok(await getAbstimmungMailStand(id));
  }),
  // The page repeats this request until all mails are out; each mail is logged when it fails
  { quiet: true }
);

export const AbstimmungenCollection = withErrorHandling(AbstimmungenCollectionEndpoint);
export const AbstimmungItem = withErrorHandling(AbstimmungItemEndpoint);
export const AbstimmungStimme = withErrorHandling(AbstimmungStimmeEndpoint);
export const AbstimmungEinladung = withErrorHandling(AbstimmungEinladungEndpoint);
export const AbstimmungErinnerung = withErrorHandling(AbstimmungErinnerungEndpoint);
export const AbstimmungMails = withErrorHandling(AbstimmungMailsEndpoint);
