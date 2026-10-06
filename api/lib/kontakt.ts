import { CONFIG } from './config';
import { escapeHtml, sendMail } from './mail';
import { mailLayout } from './mail-template';
import { findKontaktTopic } from './kontakt-validation';
import type { KontaktMessage } from './kontakt-validation';

interface KontaktQuota {
  hour: number;
  hourCount: number;
  day: number;
  dayCount: number;
}

let quota: KontaktQuota = { hour: 0, hourCount: 0, day: 0, dayCount: 0 };

/**
 * Admits one message within the hourly and daily limit of this instance. The proof of work
 * makes each message expensive; this limit caps the mails if someone pays that price anyway.
 * Uses fixed UTC hour/day buckets and increments both counters on success, with no refund
 * for later send failures. Returns false without changing counters if either limit is reached.
 * @param now Unix time in milliseconds used to select the quota buckets.
 */
export function reserveKontaktQuota(now = Date.now()): boolean {
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / 86_400_000);
  const current: KontaktQuota = {
    hour,
    day,
    hourCount: quota.hour === hour ? quota.hourCount : 0,
    dayCount: quota.day === day ? quota.dayCount : 0,
  };
  if (
    current.hourCount >= CONFIG.kontakt.hourlyLimit ||
    current.dayCount >= CONFIG.kontakt.dailyLimit
  )
    return false;
  quota = { ...current, hourCount: current.hourCount + 1, dayCount: current.dayCount + 1 };
  return true;
}

/** Resets the limit, for tests. */
export function resetKontaktQuota(): void {
  quota = { hour: 0, hourCount: 0, day: 0, dayCount: 0 };
}

/** Returns the configured topic label, falling back to the supplied topic ID. */
function topicLabel(message: KontaktMessage): string {
  return findKontaktTopic(message.topic)?.label ?? message.topic;
}

/** Escapes plain text as HTML and converts LF or CRLF line breaks to br elements. */
function paragraphs(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br />');
}

/** Builds the subject and escaped HTML for the Stamm; does not send the message. */
export function kontaktStammMail(message: KontaktMessage): { subject: string; html: string } {
  const label = topicLabel(message);
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Neue Nachricht über das Kontaktformular</h1>
    <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px;">
      <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">Von</td><td>${escapeHtml(message.name)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">E-Mail</td><td><a href="mailto:${escapeHtml(message.email)}" style="color:#003056;">${escapeHtml(message.email)}</a></td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">Thema</td><td>${escapeHtml(label)}</td></tr>
    </table>
    <div style="margin:16px 0;padding:12px 16px;border-left:4px solid #810a1a;background:#faf7f2;">
      ${paragraphs(message.message)}
    </div>
    <p style="font-size:13px;color:#6b7280;">
      Mit „Antworten“ geht deine Antwort direkt an ${escapeHtml(message.email)}. Die Adresse wurde
      nicht überprüft – sie kann auch falsch oder fremd sein.
    </p>`);
  return { subject: `Kontaktformular: ${label} – ${message.name}`, html };
}

/**
 * Receipt for the visitor. It contains nothing the visitor wrote, so the form cannot be used
 * to send text to someone else's address.
 */
export function kontaktReceiptMail(message: KontaktMessage): { subject: string; html: string } {
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Deine Nachricht ist bei uns angekommen</h1>
    <p>Hallo,</p>
    <p>vielen Dank für deine Nachricht zum Thema „${escapeHtml(topicLabel(message))}“. Sie ist bei
      uns angekommen und wir melden uns so bald wie möglich bei dir. Da wir alle ehrenamtlich
      dabei sind, kann das ein paar Tage dauern.</p>
    <p>Hast du uns nicht geschrieben? Dann hat jemand deine Adresse im Kontaktformular auf
      stamm-phoenix.de angegeben. Du kannst diese E-Mail einfach ignorieren.</p>
    <p>Gut Pfad<br />DPSG Stamm Phoenix</p>`);
  return { subject: 'Deine Nachricht an den Stamm Phoenix', html };
}

/**
 * Sends the message from and to the configured contact mailbox, with the visitor as Reply-To.
 * @throws Propagates mail client initialization, authentication, and Graph request errors.
 */
export async function sendKontaktMessage(message: KontaktMessage): Promise<void> {
  const { mailbox } = CONFIG.kontakt;
  const { subject, html } = kontaktStammMail(message);
  await sendMail(mailbox, subject, html, mailbox, { address: message.email, name: message.name });
}

/**
 * Sends a receipt to the visitor from the configured contact mailbox, omitting their name
 * and message text.
 * @throws Propagates mail client initialization, authentication, and Graph request errors.
 */
export async function sendKontaktReceipt(message: KontaktMessage): Promise<void> {
  const { mailbox } = CONFIG.kontakt;
  const { subject, html } = kontaktReceiptMail(message);
  await sendMail(message.email, subject, html, mailbox);
}
