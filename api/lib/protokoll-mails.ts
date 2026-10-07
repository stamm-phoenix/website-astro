import { CONFIG } from './config';
import type { MailAttachment } from './mail';
import { escapeHtml, sendBlindCopyMail, sendMail } from './mail';
import { mailButton, mailLayout } from './mail-template';
import { formatGermanDate } from './protokolle';

const FALLBACK = 'Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:';

/** Title with date, e.g. „Leitendenrunde vom 07.10.2026“. */
function heading(title: string, date: string): string {
  return date ? `${title} vom ${formatGermanDate(date)}` : title;
}

export interface ProtokollMail {
  title: string;
  date: string;
  approvedBy: string;
  url: string;
  /** The minutes as PDF; without it the mail only carries the link. */
  pdf?: MailAttachment;
}

/** Sends approved minutes to all leaders in blind copy. */
export async function sendProtokollMail(recipients: string[], data: ProtokollMail): Promise<void> {
  const name = heading(data.title, data.date);
  const attachmentNote = data.pdf
    ? 'Du findest es als PDF im Anhang und im Leitendenbereich.'
    : 'Das PDF war zu groß für den Anhang. Du findest es im Leitendenbereich.';
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;">Protokoll: ${escapeHtml(name)}</h1>
    <p>Hallo zusammen,</p>
    <p>das Protokoll <strong>${escapeHtml(name)}</strong> ist freigegeben. ${attachmentNote}</p>
    ${mailButton(data.url, 'Protokoll öffnen', FALLBACK)}
    <p style="font-size:13px;color:#6b7280;">Freigegeben von ${escapeHtml(data.approvedBy)}.
      Der Link funktioniert nach der Anmeldung mit deinem Stammes-Account.</p>
  `);
  await sendBlindCopyMail({
    sender: CONFIG.protokolle.sender,
    bcc: recipients,
    subject: `Protokoll: ${name}`,
    html,
    attachments: data.pdf ? [data.pdf] : [],
  });
}

export interface ProtokollRejectedMail {
  /** Login (e-mail address) of the person who created the minutes. */
  to: string;
  title: string;
  date: string;
  note: string;
  reviewer: string;
  url: string;
}

/** Tells the author what a reviewer wants changed. */
export async function sendProtokollRejectedMail(data: ProtokollRejectedMail): Promise<void> {
  const name = heading(data.title, data.date);
  const note = escapeHtml(data.note).replace(/\r?\n/g, '<br />');
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;">Protokoll zurückgegeben</h1>
    <p>Hallo,</p>
    <p>${escapeHtml(data.reviewer)} hat das Protokoll <strong>${escapeHtml(name)}</strong>
      zurückgegeben:</p>
    <div style="margin:16px 0;padding:12px 16px;border-left:4px solid #810a1a;background:#faf7f2;">${note}</div>
    <p>Bitte überarbeite es in Word und gib es danach erneut zum Review.</p>
    ${mailButton(data.url, 'Protokolle öffnen', FALLBACK)}
  `);
  await sendMail(data.to, `Protokoll zurückgegeben: ${name}`, html, CONFIG.protokolle.sender);
}
