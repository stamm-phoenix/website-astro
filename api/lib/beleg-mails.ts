import { CONFIG } from './config';
import { escapeHtml, sendMail } from './mail';
import { mailButton, mailLayout } from './mail-template';
import { readTaskDirectory } from './task-directory';

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

export interface SubmittedBelegMail {
  shop: string;
  /** `YYYY-MM-DD` */
  date: string;
  amountCent: number;
  /** Who gets the Auslage back; empty without one. */
  paidBy: string;
  payout: boolean;
  aktion: string;
  note: string;
  /** Name (or login) of the person who submitted the receipt. */
  submitter: string;
  /** Whether a rejected receipt was corrected and submitted again. */
  resubmitted: boolean;
  url: string;
}

/** Mailbox the receipt mails are sent from; without it no mail is sent. */
export function belegMailSender(): string | undefined {
  return CONFIG.mail.belegeSender;
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

/**
 * The members of the team „Kasse“ to tell about a new receipt: person accounts of its Entra
 * group with an address of the Stamm, without the person who submitted it.
 */
export async function belegReviewerAddresses(
  submittedBy: string,
  signal?: AbortSignal
): Promise<string[]> {
  const users = await readTaskDirectory(signal, CONFIG.staff.teams.kasse.groupId);
  const submitter = submittedBy.toLowerCase();
  return users.map((user) => user.login).filter((login) => login !== submitter);
}

/** Subject and text of the note to the Kasse about a submitted receipt. */
export function belegSubmittedMailContent(data: SubmittedBelegMail): {
  subject: string;
  html: string;
} {
  const rows: [string, string][] = [
    ['Geschäft', data.shop],
    ['Datum', formatDate(data.date)],
    ['Betrag', formatEuro(data.amountCent)],
    ['Aktion', data.aktion],
    ['Auslage von', data.payout ? data.paidBy : ''],
    ['Notiz', data.note],
  ];
  const table = rows
    .filter(([, value]) => value.trim() !== '')
    .map(
      ([label, value]) => `<tr>
        <td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top;white-space:nowrap;">${label}</td>
        <td style="padding:4px 0;vertical-align:top;">${escapeHtml(value).replace(/\r?\n/g, '<br />')}</td>
      </tr>`
    )
    .join('');
  const heading = data.resubmitted ? 'Beleg erneut eingereicht' : 'Neuer Beleg zur Prüfung';
  const intro = data.resubmitted
    ? `${escapeHtml(data.submitter)} hat einen abgelehnten Beleg korrigiert und erneut eingereicht:`
    : `${escapeHtml(data.submitter)} hat einen neuen Beleg zur Prüfung eingereicht:`;
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;">${heading}</h1>
    <p>Hallo Kasse,</p>
    <p>${intro}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;">${table}</table>
    ${mailButton(data.url, 'Belege prüfen', 'Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:')}
  `);
  return { subject: `${heading}: ${data.shop}`, html };
}

/**
 * Tells the Kasse about a submitted receipt, one mail per member, all within `timeoutMs` and
 * without retries, so the request that saved the receipt answers in time.
 * @returns The addresses whose mail could not be sent.
 */
export async function sendBelegSubmittedMail(
  data: SubmittedBelegMail,
  recipients: string[],
  sender: string,
  timeoutMs = 10_000
): Promise<string[]> {
  const { subject, html } = belegSubmittedMailContent(data);
  const timeout = Math.max(1, Math.min(10_000, timeoutMs));
  const results = await Promise.allSettled(
    recipients.map((to) =>
      sendMail(to, subject, html, sender, undefined, { retry: false, timeoutMs: timeout })
    )
  );
  return recipients.filter((_to, index) => results[index]?.status === 'rejected');
}
