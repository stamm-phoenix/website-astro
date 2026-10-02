import { EnvironmentVariable } from './environment';
import { escapeHtml, sendMail } from './mail';
import { mailButton, mailLayout } from './mail-template';

export interface RejectedBelegMail {
  /** Login (e-mail address) of the person who uploaded the receipt. */
  to: string;
  shop: string;
  /** `YYYY-MM-DD` */
  date: string;
  amountCent: number;
  reason: string;
  /** Login of the member of the Kasse who rejected the receipt. */
  reviewer: string;
  url: string;
}

/** Mailbox the rejection mails are sent from; without it no mail is sent. */
export function belegMailSender(): string | undefined {
  return process.env[EnvironmentVariable.BELEGE_MAIL_SENDER]?.trim() || undefined;
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}.${month}.${year}` : iso;
}

function formatEuro(cent: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cent / 100);
}

/** Tells the uploader why their receipt was rejected and how to correct it. */
export async function sendBelegRejectedMail(
  data: RejectedBelegMail,
  sender: string
): Promise<void> {
  const summary = `${data.shop} vom ${formatDate(data.date)} über ${formatEuro(data.amountCent)}`;
  const reason = escapeHtml(data.reason).replace(/\r?\n/g, '<br />');
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;">Dein Beleg wurde abgelehnt</h1>
    <p>Hallo,</p>
    <p>die Kasse hat deinen Beleg <strong>${escapeHtml(summary)}</strong> abgelehnt:</p>
    <div style="margin:16px 0;padding:12px 16px;border-left:4px solid #810a1a;background:#faf7f2;">${reason}</div>
    <p>Bitte öffne den Beleg im Leitendenbereich, korrigiere die Angaben oder lade ein neues Foto hoch
      und reiche ihn erneut ein.</p>
    ${mailButton(data.url, 'Belege öffnen', 'Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:')}
    <p style="font-size:13px;color:#6b7280;">Bei Fragen wende dich an ${escapeHtml(data.reviewer)}.</p>
  `);
  await sendMail(data.to, `Beleg abgelehnt: ${data.shop}`, html, sender);
}
