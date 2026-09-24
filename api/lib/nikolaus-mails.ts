import { escapeHtml, sendMail } from './mail';
import { EnvironmentVariable, getEnvironment } from './environment';
import type { NikolausSlotDefinition } from './nikolaus-config';
import { formatNikolausDate } from './nikolaus-config';

interface BookingMailData {
  id: string;
  token: string;
  familyName: string;
  email: string;
  withKrampus: boolean;
  slot: NikolausSlotDefinition;
}

const CONTACT_MAIL = 'kontakt@stamm-phoenix.de';

function getManageUrl(id: string, token: string): string {
  const baseUrl = getEnvironment(EnvironmentVariable.NIKOLAUS_SITE_URL).replace(/\/+$/, '');
  const params = new URLSearchParams({ id, token });
  return `${baseUrl}/nikolaus/bestaetigen?${params.toString()}`;
}

function formatSlot(slot: NikolausSlotDefinition): string {
  return `${formatNikolausDate(slot.date)}, ${slot.time}–${slot.endTime} Uhr`;
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

function summary(data: BookingMailData): string {
  return `<table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Termin</td><td style="padding:4px 0;"><strong>${escapeHtml(formatSlot(data.slot))}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Familie</td><td style="padding:4px 0;">${escapeHtml(data.familyName)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Krampus</td><td style="padding:4px 0;">${data.withKrampus ? 'darf mit reinkommen' : 'bleibt draußen'}</td></tr>
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

export async function sendConfirmationRequestMail(
  data: BookingMailData,
  holdMinutes: number
): Promise<void> {
  const url = getManageUrl(data.id, data.token);
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
    <p>Über denselben Link können Sie den Termin auch wieder absagen.</p>
  `);
  await sendMail(data.email, 'Bitte bestätigen: Ihr Termin mit dem Nikolaus', html);
}

export async function sendBookingConfirmedMail(data: BookingMailData): Promise<void> {
  const url = getManageUrl(data.id, data.token);
  const html = layout(`
    <h1 style="font-size:20px;color:#003056;">Ihr Nikolaus-Termin ist bestätigt</h1>
    <p>Hallo Familie ${escapeHtml(data.familyName)},</p>
    <p>Ihr Termin ist jetzt verbindlich gebucht. Der Nikolaus freut sich auf Ihren Besuch!</p>
    ${summary(data)}
    <p>Bitte legen Sie die Zettel für das Goldene Buch und ggf. Geschenke vor dem Termin draußen bereit.
      Es kann zu Verspätungen von bis zu 30 Minuten kommen.</p>
    <p>Falls Sie doch absagen müssen, können Sie das hier tun:</p>
    ${button(url, 'Termin verwalten / absagen')}
  `);
  await sendMail(data.email, 'Bestätigt: Ihr Termin mit dem Nikolaus', html);
}
