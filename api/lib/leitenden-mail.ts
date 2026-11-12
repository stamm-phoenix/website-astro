/**
 * Notes to a single leader (#552), e.g. a mail assigned in a Postfach, a reminder of a task or a
 * rejected receipt. They go to the login in our tenant and also to the primary address of the
 * CampFlow person linked to it in the module „Personen“ (`docs/personen.md`), so leaders who do
 * not read their Stamm mailbox still see them. Every module that tells one leader about something
 * sends through `sendLeitendenMail`; mails to many leaders at once and mails to parents or guests
 * do not.
 */
import type { CampflowPerson } from './campflow';
import { campflowGet, getCampflowMembers } from './campflow';
import type { MailReplyTo } from './mail';
import { sendMail } from './mail';
import { cachedIch, getCampflowPersonId, ICH_CACHE_MS } from './personen';
import { email } from './sammelbestellung-validation';

/** How long a note waits for the CampFlow address at most before it goes to the login alone. */
export const CAMPFLOW_ADRESSE_TIMEOUT_MS = 5000;

/** Sending options as for `sendMail`; `timeoutMs` covers looking up the address as well. */
export interface LeitendenMailOptions {
  /** Mailbox to send from; defaults to that of `sendMail`. */
  sender?: string;
  replyTo?: MailReplyTo;
  retry?: boolean;
  timeoutMs?: number;
  saveToSentItems?: boolean;
}

/** A valid address in lower case, or `''`. */
function gueltig(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return '';
  try {
    return email(value.trim()).toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The primary address of the CampFlow person linked to the login, from memory or CampFlow; `''`
 * without a link or a valid address, and if another member uses it too, e.g. a family address:
 * notes may name mails of a Postfach or receipts, which must not land where others read along.
 * @throws Propagates database and CampFlow errors.
 */
async function ladeCampflowAdresse(login: string): Promise<string> {
  const id = await getCampflowPersonId(login);
  if (!id) return '';
  const cached = cachedIch(id);
  if (cached && Date.now() - cached.at < ICH_CACHE_MS) {
    return cached.campflow.adresseGeteilt ? '' : gueltig(cached.campflow.email);
  }
  const [person, members] = await Promise.all([
    campflowGet<CampflowPerson>(`/lists/member/persons/${encodeURIComponent(id)}`),
    getCampflowMembers(),
  ]);
  const address = gueltig(person.primary_email);
  const geteilt = members.some(
    (member) => member.id !== id && gueltig(member.primary_email) === address
  );
  return address && !geteilt ? address : '';
}

/** Looking up the address, as an object so tests can replace it. */
export const leitendenAdresse = { campflow: ladeCampflowAdresse };

/**
 * `leitendenAdresse.campflow` within `timeoutMs`; a failure or no answer in time means no
 * address, as the note still reaches the login.
 */
async function campflowAdresseInnerhalb(login: string, timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(''), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([leitendenAdresse.campflow(login).catch(() => ''), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The login and, if it is another one, the CampFlow address, without duplicates. */
export function leitendenEmpfaenger(login: string, campflowAdresse: string): string[] {
  const own = login.trim();
  const extra = campflowAdresse.trim();
  return extra && extra.toLowerCase() !== own.toLowerCase() ? [own, extra] : [own];
}

/**
 * Sends a note to one leader: one mail to their login and the address of their linked CampFlow
 * person. Without a link, or if the database or CampFlow fail or take too long, it goes to the
 * login alone. With `timeoutMs`, at most a third of it is spent on the address.
 * @param login Login of the leader in our tenant.
 * @throws Propagates mail client setup, authentication and Graph request errors.
 */
export async function sendLeitendenMail(
  login: string,
  subject: string,
  html: string,
  options: LeitendenMailOptions = {}
): Promise<void> {
  const start = Date.now();
  const { sender, replyTo, timeoutMs, ...rest } = options;
  const suche = timeoutMs
    ? Math.max(1, Math.min(CAMPFLOW_ADRESSE_TIMEOUT_MS, Math.floor(timeoutMs / 3)))
    : CAMPFLOW_ADRESSE_TIMEOUT_MS;
  const an = leitendenEmpfaenger(login, await campflowAdresseInnerhalb(login, suche));
  await sendMail(an.length === 1 ? an[0] : an, subject, html, sender, replyTo, {
    ...rest,
    ...(timeoutMs ? { timeoutMs: Math.max(1, timeoutMs - (Date.now() - start)) } : {}),
  });
}
