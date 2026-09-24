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
  const holdHours =
    holdMinutes % 60 === 0 ? `${holdMinutes / 60} Stunden` : `${holdMinutes} Minuten`;
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
