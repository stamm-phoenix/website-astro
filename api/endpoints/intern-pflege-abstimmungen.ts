import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { validateAbstimmung } from '../lib/abstimmung-schema';
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
  getAbstimmungLogins,
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
import { NOT_FOUND, NO_CONTENT, ok, readEtag, readIfMatch } from '../lib/pflege-api';
import { ValidationError } from '../lib/validation/errors';
import { eigeneAdresse, mitEigenerAdresse } from '../lib/personen';
import {
  audienceVersion,
  protokollDeliveryAddresses,
  protokollRecipients,
} from '../lib/protokolle';
import { errorResponse, readJsonBody } from '../lib/response-utils';
import { getSiteUrl } from '../lib/site-url';
import type { ClientPrincipal } from '../lib/staff-auth';
import { getPrincipalFirstName } from '../lib/staff-auth';
import { getTaskDirectoryUsers } from '../lib/task-directory';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

const AREA = 'abstimmungen';
/** Mails one request sends; the page asks again until none are left. */
/**
 * No mail is started later than this into a request, so even a mail that takes its whole time
 * limit ends well before the 45 seconds of Static Web Apps.
 */

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

/** The module's own refusals; the other errors go to `staffHandler`. */
function abstimmungHandler(handler: StaffRequestHandler): StaffRequestHandler {
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
export const AbstimmungenCollectionEndpoint = staffHandler(
  AREA,
  abstimmungHandler(async (request, _context, principal) => {
    if (request.method === 'GET') return ok(await listAbstimmungen(await person(principal)));
    const input = validateAbstimmung(await readJsonBody(request));
    return ok({ id: await createAbstimmung(input, await person(principal)) }, 201);
  })
);

/**
 * GET: one Abstimmung with the own answer; the organizer also gets the shared link and the
 * invitations. PATCH `{ etag, geschlossen }` ends or reopens it, PATCH with the form fields
 * changes it. DELETE (If-Match) deletes it. Changes only by the organizer.
 */
export const AbstimmungItemEndpoint = staffHandler(
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
    const body = await readJsonBody(request);
    if (body && typeof body.geschlossen === 'boolean' && body.titel === undefined) {
      await setAbstimmungGeschlossen(id, readEtag(body), body.geschlossen, login);
      return NO_CONTENT;
    }
    await updateAbstimmung(id, readEtag(body), validateAbstimmung(body), login);
    return NO_CONTENT;
  })
);

/** PUT `{ gewaehlt, vielleicht? }`: the answer of the logged-in person; replaces an earlier one. */
export const AbstimmungStimmeEndpoint = staffHandler(
  AREA,
  abstimmungHandler(async (request, _context, principal) => {
    const id = routeId(request);
    if (id === undefined) return NOT_FOUND;
    const body = await readJsonBody(request);
    await voteAsStaff(id, await person(principal), {
      gewaehlt: body?.gewaehlt,
      vielleicht: body?.vielleicht,
    });
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
export const AbstimmungEinladungEndpoint = staffHandler(
  AREA,
  abstimmungHandler(async (request, context, principal) => {
    const id = routeId(request);
    if (id === undefined) return NOT_FOUND;
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
    // Several CampFlow persons with one address, e.g. a family: the list joins their names
    const familien = new Set(
      recipients.filter((entry) => entry.name.includes(', ')).map((entry) => entry.email)
    );
    const logins = await getAbstimmungLogins(id);
    // Leaders who answered here may have a CampFlow address shared with others, so it is not
    // stored with their answer; their own invitation would count them twice
    const eigeneAdressen = (
      await Promise.all(logins.map(async (eigener) => (await eigeneAdresse(eigener)).email))
    ).filter(Boolean);
    if (action === 'preview') {
      const detail = await getAbstimmungDetail(id, await identity(principal), getSiteUrl(request));
      // The addresses the send skips, so the dialog counts only who gets an invitation
      const eingeladen = new Set([
        ...(detail?.teilnahmen ?? []).map((t) => t.email).filter(Boolean),
        ...logins,
        ...eigeneAdressen.filter((email) => !familien.has(email)),
      ]);
      return ok({
        recipients: recipients.length,
        version,
        list: await mitEigenerAdresse(principal.userDetails, recipients),
        personen,
        eingeladen: [...eingeladen],
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
    const result = await queueAbstimmungEinladungen(
      id,
      principal.userDetails.trim().toLowerCase(),
      addresses.map((email) => ({
        email,
        name: names.get(email) ?? '',
        familie: familien.has(email),
      })),
      eigeneAdressen
    );
    return ok({ ...result, ...(await getAbstimmungMailStand(id)) });
  })
);

/**
 * Reminder to everyone invited who has not answered.
 * - `{ action: 'preview' }`: how many that are.
 * - `{ action: 'send' }`: queues the reminders; they go out through `…/mails`.
 */
export const AbstimmungErinnerungEndpoint = staffHandler(
  AREA,
  abstimmungHandler(async (request, _context, principal) => {
    const id = routeId(request);
    if (id === undefined) return NOT_FOUND;
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
export const AbstimmungMailsEndpoint = staffHandler(
  AREA,
  abstimmungHandler(async (request, context: InvocationContext, principal) => {
    const id = routeId(request);
    if (id === undefined) return NOT_FOUND;
    const kopf = await organizerKopf(id, principal);
    // Queued mails wait while it is ended; reopening sends them
    if (kopf.geschlossen_am) return CLOSED;
    const siteUrl = getSiteUrl(request);
    const started = Date.now();
    for (let sent = 0; sent < 5; sent++) {
      if (Date.now() - started + ABSTIMMUNG_MAIL_TIMEOUT_MS > 30_000) break;
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

app.http('internPflegeAbstimmungen', {
  route: 'intern/pflege/abstimmungen',
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: AbstimmungenCollectionEndpoint,
});

app.http('internPflegeAbstimmung', {
  route: 'intern/pflege/abstimmungen/{id}',
  methods: ['GET', 'PATCH', 'DELETE'],
  authLevel: 'anonymous',
  handler: AbstimmungItemEndpoint,
});

app.http('internPflegeAbstimmungStimme', {
  route: 'intern/pflege/abstimmungen/{id}/stimme',
  methods: ['PUT'],
  authLevel: 'anonymous',
  handler: AbstimmungStimmeEndpoint,
});

app.http('internPflegeAbstimmungEinladung', {
  route: 'intern/pflege/abstimmungen/{id}/einladung',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: AbstimmungEinladungEndpoint,
});

app.http('internPflegeAbstimmungErinnerung', {
  route: 'intern/pflege/abstimmungen/{id}/erinnerung',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: AbstimmungErinnerungEndpoint,
});

app.http('internPflegeAbstimmungMails', {
  route: 'intern/pflege/abstimmungen/{id}/mails',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: AbstimmungMailsEndpoint,
});
