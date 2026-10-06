import { getClient } from './token';
import { CONFIG } from './config';

/** Address and display name for the Reply-To header. */
export interface MailReplyTo {
  address: string;
  name?: string;
}

/**
 * Sends an HTML e-mail via Microsoft Graph from the configured sender mailbox.
 * Requires the application permission `Mail.Send` for the app registration.
 * Requests that a copy be saved in the sender's Sent Items.
 * @param to Recipient e-mail address.
 * @param subject Subject line.
 * @param html HTML body.
 * @param sender Sender mailbox; defaults to CONFIG.mail.nikolausSender when omitted.
 * @param replyTo Where replies go instead of the sender, e.g. a visitor of the contact form.
 * @throws Propagates mail client initialization, authentication, and Graph request errors.
 */
export async function sendMail(
  to: string,
  subject: string,
  html: string,
  sender?: string,
  replyTo?: MailReplyTo
): Promise<void> {
  const client = getClient();

  const NIKOLAUS_MAIL_SENDER = sender ?? CONFIG.mail.nikolausSender;

  await client.api(`/users/${encodeURIComponent(NIKOLAUS_MAIL_SENDER)}/sendMail`).post({
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: to } }],
      ...(replyTo ? { replyTo: [{ emailAddress: replyTo }] } : {}),
    },
    saveToSentItems: true,
  });
}

/** Escapes a string for safe use inside HTML content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
