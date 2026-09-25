import { escapeHtml, sendMail } from './mail';
import { EnvironmentVariable, getEnvironment } from './environment';
import type { NikolausSlotDefinition } from './nikolaus-config';
import type { NikolausBookingDetails } from './nikolaus-validation';
import {
  NIKOLAUS_CONFIG,
  NIKOLAUS_TIME_ZONE,
  formatNikolausDate,
  getChangeDeadline,
} from './nikolaus-config';

export interface BookingMailData extends NikolausBookingDetails {
  token: string;
  slot: NikolausSlotDefinition;
}

const CONTACT_MAIL = 'kontakt@stamm-phoenix.de';

function getManageUrl(token: string): string {
  const baseUrl = getEnvironment(EnvironmentVariable.NIKOLAUS_SITE_URL).replace(/\/+$/, '');
  const params = new URLSearchParams({ token });
  return `${baseUrl}/nikolaus/termin?${params.toString()}`;
}

function formatSlot(slot: NikolausSlotDefinition): string {
  return `${formatNikolausDate(slot.date)}, ${slot.time}–${slot.endTime} Uhr`;
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: NIKOLAUS_TIME_ZONE,
  }).format(date);
}

function formatDeadline(slot: NikolausSlotDefinition): string {
  return `${formatDateTime(getChangeDeadline(slot.key))} Uhr`;
}

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-top:4px solid #810a1a;padding:24px;">
    ${content}
    <p style="margin-top:32px;font-size:12px;color:#6b7280;">
      DPSG Stamm Phoenix Feldkirchen-Westerham · Fragen? <a href="mailto:${CONTACT_MAIL}" style="color:#003056;">${CONTACT_MAIL}</a>
    </p>
  </div>
</body>
</html>`;
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top;white-space:nowrap;">${label}</td><td style="padding:4px 0;vertical-align:top;">${value}</td></tr>`;
}

/** Escapes text and keeps line breaks of multi-line fields. */
function multiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br />');
}

function summary(data: BookingMailData): string {
  return `<table style="border-collapse:collapse;margin:16px 0;font-size:14px;vertical-align:top;">
      ${row('Termin', `<strong>${escapeHtml(formatSlot(data.slot))}</strong>`)}
      ${row('Familie', escapeHtml(data.familyName))}
      ${row('Adresse', `${escapeHtml(data.street)}<br />${escapeHtml(`${data.postalCode} ${data.city}`)}`)}
      ${data.addressNotes ? row('Hinweise zur Adresse', multiline(data.addressNotes)) : ''}
      ${row('Telefon', escapeHtml(data.phone))}
      ${row('Kinder', String(data.childrenCount))}
      ${row('Krampus', data.withKrampus ? 'darf mit reinkommen' : 'bleibt draußen')}
      ${row('Versteck', multiline(data.hidingPlace))}
      ${data.notes ? row('Bemerkungen', multiline(data.notes)) : ''}
    </table>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;">
      <a href="${escapeHtml(href)}" style="display:inline-block;background:#810a1a;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px;">${label}</a>
    </p>
    <p style="font-size:12px;color:#6b7280;">Falls der Button nicht funktioniert, kopieren Sie diese Adresse in Ihren Browser:<br />
      <a href="${escapeHtml(href)}" style="color:#003056;word-break:break-all;">${escapeHtml(href)}</a>
    </p>`;
}

function deadlineHint(slot: NikolausSlotDefinition): string {
  return `<p>Über denselben Link können Sie Ihre Angaben ändern, auf einen anderen freien Termin umbuchen
      oder absagen – bis <strong>${escapeHtml(formatDeadline(slot))}</strong>
      (${NIKOLAUS_CONFIG.changeDeadlineHours} Stunden vor Ihrem Termin). Danach planen unsere Teams ihre Touren;
      Änderungen sind dann nur noch per E-Mail an <a href="mailto:${CONTACT_MAIL}" style="color:#003056;">${CONTACT_MAIL}</a> möglich.</p>`;
}

export async function sendConfirmationRequestMail(
  data: BookingMailData,
  holdMinutes: number
): Promise<void> {
  const url = getManageUrl(data.token);
  const hours = holdMinutes / 60;
  const holdHours =
    holdMinutes % 60 === 0
      ? `${hours} ${hours === 1 ? 'Stunde' : 'Stunden'}`
      : `${holdMinutes} ${holdMinutes === 1 ? 'Minute' : 'Minuten'}`;
  const html = layout(`
    <h1 style="font-size:20px;color:#003056;">Bitte bestätigen Sie Ihren Nikolaus-Termin</h1>
    <p>Hallo Familie ${escapeHtml(data.familyName)},</p>
    <p>vielen Dank für Ihre Anmeldung zum Nikolausdienst! Ihr Termin ist für Sie reserviert, wird aber
      <strong>erst gültig, wenn Sie ihn über den folgenden Link bestätigen</strong>.</p>
    ${summary(data)}
    ${button(url, 'Termin jetzt bestätigen')}
    <p>Bitte bestätigen Sie innerhalb von <strong>${holdHours}</strong>, sonst verfällt die Reservierung und der Termin wird wieder freigegeben.</p>
    ${deadlineHint(data.slot)}
  `);
  await sendMail(data.email, 'Bitte bestätigen: Ihr Termin mit dem Nikolaus', html);
}

export async function sendBookingConfirmedMail(data: BookingMailData): Promise<void> {
  const url = getManageUrl(data.token);
  const html = layout(`
    <h1 style="font-size:20px;color:#003056;">Ihr Nikolaus-Termin ist bestätigt</h1>
    <p>Hallo Familie ${escapeHtml(data.familyName)},</p>
    <p>Ihr Termin ist jetzt verbindlich gebucht. Der Nikolaus freut sich auf Ihren Besuch!</p>
    ${summary(data)}
    <p>Bitte legen Sie die Zettel für das Goldene Buch und ggf. Geschenke vor dem Termin draußen bereit.
      Es kann zu Verspätungen von bis zu 30 Minuten kommen.</p>
    ${deadlineHint(data.slot)}
    ${button(url, 'Termin verwalten')}
  `);
  await sendMail(data.email, 'Bestätigt: Ihr Termin mit dem Nikolaus', html);
}

/**
 * Informs about changed booking details or a new slot.
 * @param previousSlot The old slot if the booking was rescheduled.
 */
export async function sendBookingChangedMail(
  data: BookingMailData,
  previousSlot?: NikolausSlotDefinition
): Promise<void> {
  const url = getManageUrl(data.token);
  const intro = previousSlot
    ? `<p>Ihr Termin wurde erfolgreich verlegt – statt <s>${escapeHtml(formatSlot(previousSlot))}</s>
        kommt der Nikolaus jetzt am <strong>${escapeHtml(formatSlot(data.slot))}</strong>.</p>`
    : '<p>Ihre Angaben zum Nikolaus-Termin wurden geändert. Hier ist der aktuelle Stand:</p>';
  const html = layout(`
    <h1 style="font-size:20px;color:#003056;">Ihr Nikolaus-Termin wurde geändert</h1>
    <p>Hallo Familie ${escapeHtml(data.familyName)},</p>
    ${intro}
    ${summary(data)}
    ${deadlineHint(data.slot)}
    ${button(url, 'Termin verwalten')}
  `);
  await sendMail(data.email, 'Geändert: Ihr Termin mit dem Nikolaus', html);
}

/** Tells the previous address that booking mails now go to another address. */
export async function sendEmailChangedNotice(
  previousEmail: string,
  newEmail: string,
  familyName: string
): Promise<void> {
  const html = layout(`
    <h1 style="font-size:20px;color:#003056;">E-Mail-Adresse geändert</h1>
    <p>Hallo Familie ${escapeHtml(familyName)},</p>
    <p>bei Ihrem Nikolaus-Termin wurde die E-Mail-Adresse auf <strong>${escapeHtml(newEmail)}</strong> geändert.
      Alle weiteren Nachrichten zu diesem Termin gehen an die neue Adresse.</p>
    <p>Falls Sie diese Änderung nicht vorgenommen haben, melden Sie sich bitte unter
      <a href="mailto:${CONTACT_MAIL}" style="color:#003056;">${CONTACT_MAIL}</a>.</p>
  `);
  await sendMail(previousEmail, 'Hinweis: E-Mail-Adresse Ihres Nikolaus-Termins geändert', html);
}

/**
 * Sends a new management link, e.g. after the previous mail got lost.
 * @param reservedUntil Set for unconfirmed bookings, which still need to be confirmed.
 */
export async function sendManageLinkMail(
  data: BookingMailData,
  reservedUntil?: Date
): Promise<void> {
  const url = getManageUrl(data.token);
  const confirmHint = reservedUntil
    ? `<p><strong>Ihr Termin ist noch nicht bestätigt.</strong> Bitte bestätigen Sie ihn über den Link bis
        ${escapeHtml(formatDateTime(reservedUntil))} Uhr, sonst verfällt die Reservierung.</p>`
    : '';
  const html = layout(`
    <h1 style="font-size:20px;color:#003056;">Ihr Link zur Terminverwaltung</h1>
    <p>Hallo Familie ${escapeHtml(data.familyName)},</p>
    <p>Sie haben einen neuen Link zu Ihrem Nikolaus-Termin angefordert. Hier ist Ihr aktueller Stand:</p>
    ${summary(data)}
    ${confirmHint}
    ${button(url, reservedUntil ? 'Termin bestätigen' : 'Termin verwalten')}
    <p><strong>Wichtig:</strong> Links aus früheren E-Mails zu diesem Termin funktionieren ab sofort nicht mehr.</p>
    ${deadlineHint(data.slot)}
    <p style="font-size:12px;color:#6b7280;">Sie haben keinen neuen Link angefordert? Dann können Sie diese E-Mail ignorieren –
      Ihr Termin bleibt unverändert, nutzen Sie einfach den Link aus dieser E-Mail.</p>
  `);
  await sendMail(data.email, 'Ihr Link zum Nikolaus-Termin', html);
}

/** Inline spacing for the formatting tags a staff message may contain (mail clients ignore CSS classes). */
const MESSAGE_TAG_STYLES: Record<string, string> = {
  p: 'margin:0 0 12px;',
  div: 'margin:0 0 12px;',
  ul: 'margin:0 0 12px;padding-left:20px;',
  ol: 'margin:0 0 12px;padding-left:20px;',
  li: 'margin:0 0 4px;',
};

/** Adds inline spacing to sanitized message HTML, which only contains bare formatting tags. */
function styleMessage(html: string): string {
  return html.replace(
    /<(p|div|ul|ol|li)>/g,
    (_tag, name: string) => `<${name} style="${MESSAGE_TAG_STYLES[name]}">`
  );
}

export interface StaffMessageMailData {
  to: string;
  familyName: string;
  /** Slot of the booking; omitted from the mail if it is no longer configured. */
  slot: NikolausSlotDefinition | undefined;
  subject: string;
  /** Message body, already sanitized to plain formatting tags. */
  messageHtml: string;
  /** First name of the staff member writing the message. */
  senderName: string;
}

/** Highlighted block with a message written by the team. */
function messageBlock(messageHtml: string): string {
  return `<div style="margin:16px 0;padding:12px 16px;border-left:4px solid #810a1a;background:#faf7f2;">
      ${styleMessage(messageHtml)}
    </div>`;
}

/** Signature of mails written by a staff member, plus the hint that replies reach the team. */
function staffSignature(senderName: string): string {
  return `<p>Viele Grüße<br />${escapeHtml(senderName)} – für das Team vom Nikolausdienst</p>
    <p style="font-size:13px;color:#6b7280;">Sie können einfach auf diese E-Mail antworten, Ihre Antwort landet direkt bei unserem Team.</p>`;
}

/** A personal message from the Nikolaus team to a family; replies go to the Nikolaus mailbox. */
export async function sendStaffMessageMail(data: StaffMessageMailData): Promise<void> {
  const about = data.slot
    ? `zu Ihrem Nikolaus-Termin am <strong>${escapeHtml(formatSlot(data.slot))}</strong>`
    : 'zu Ihrem Nikolaus-Termin';
  const html = layout(`
    <h1 style="font-size:20px;color:#003056;">Nachricht zu Ihrem Nikolaus-Termin</h1>
    <p>Hallo Familie ${escapeHtml(data.familyName)},</p>
    <p>${about} haben wir eine Nachricht für Sie:</p>
    ${messageBlock(data.messageHtml)}
    ${staffSignature(data.senderName)}
  `);
  const subject = /^nikolausdienst\s*:/i.test(data.subject)
    ? data.subject
    : `Nikolausdienst: ${data.subject}`;
  await sendMail(data.to, subject, html);
}

export interface StaffRescheduleMailData {
  to: string;
  familyName: string;
  /** Old slot, or only its key if that slot is no longer configured. */
  previousSlot: NikolausSlotDefinition | string;
  slot: NikolausSlotDefinition;
  /** Optional explanation, already sanitized to plain formatting tags. */
  messageHtml?: string;
  senderName: string;
}

/** Formats a slot key like `2026-12-06T19:30` whose slot definition no longer exists. */
function formatSlotKey(key: string): string {
  const [date, time] = key.split('T');
  return time ? `${formatNikolausDate(date)}, ${time} Uhr` : key;
}

/**
 * Tells a family that the team moved their appointment. The booking keeps its token, so the
 * management link from earlier mails still works; the mail refers to it instead of a new one.
 */
export async function sendStaffRescheduleMail(data: StaffRescheduleMailData): Promise<void> {
  const previous =
    typeof data.previousSlot === 'string'
      ? formatSlotKey(data.previousSlot)
      : formatSlot(data.previousSlot);
  const html = layout(`
    <h1 style="font-size:20px;color:#003056;">Ihr Nikolaus-Termin hat sich geändert</h1>
    <p>Hallo Familie ${escapeHtml(data.familyName)},</p>
    <p>Ihr Nikolaus-Termin wurde verlegt: Statt <s>${escapeHtml(previous)}</s>
      kommt der Nikolaus jetzt am <strong>${escapeHtml(formatSlot(data.slot))}</strong>.</p>
    ${data.messageHtml ? messageBlock(data.messageHtml) : ''}
    <p>Bei Fragen zum neuen Termin melden Sie sich gern bei uns.
      Über den Link aus Ihrer bisherigen E-Mail können Sie Ihren Termin weiterhin verwalten.</p>
    ${staffSignature(data.senderName)}
  `);
  await sendMail(data.to, 'Nikolausdienst: Ihr neuer Termin', html);
}

export interface StaffCancellationMailData {
  to: string;
  familyName: string;
  /** Slot of the booking; omitted from the mail if it is no longer configured. */
  slot: NikolausSlotDefinition | undefined;
  /** Optional explanation, already sanitized to plain formatting tags. */
  messageHtml?: string;
  senderName: string;
}

/**
 * Tells a family that the team cancelled their appointment. Worded neutrally, since the
 * cancellation may have been agreed with the family. Points to a new booking while the
 * booking form is open.
 */
export async function sendStaffCancellationMail(data: StaffCancellationMailData): Promise<void> {
  const when = data.slot ? ` am <strong>${escapeHtml(formatSlot(data.slot))}</strong>` : '';
  const siteUrl = getEnvironment(EnvironmentVariable.NIKOLAUS_SITE_URL).replace(/\/+$/, '');
  const rebook = NIKOLAUS_CONFIG.active
    ? `<p>Möchten Sie einen anderen Termin? Solange noch Termine frei sind, können Sie sich unter
        <a href="${escapeHtml(siteUrl)}/nikolaus" style="color:#003056;">${escapeHtml(siteUrl.replace(/^https?:\/\//, ''))}/nikolaus</a>
        neu anmelden.</p>`
    : '';
  const html = layout(`
    <h1 style="font-size:20px;color:#003056;">Ihr Nikolaus-Termin wurde abgesagt</h1>
    <p>Hallo Familie ${escapeHtml(data.familyName)},</p>
    <p>Ihr Nikolaus-Termin${when} wurde abgesagt.</p>
    ${data.messageHtml ? messageBlock(data.messageHtml) : ''}
    ${rebook}
    <p>Bei Fragen melden Sie sich gern bei uns.</p>
    ${staffSignature(data.senderName)}
  `);
  await sendMail(data.to, 'Nikolausdienst: Ihr Termin wurde abgesagt', html);
}
