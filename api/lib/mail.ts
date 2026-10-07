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
 * Saves a copy in the sender's Sent Items.
 * @param to Recipient e-mail address.
 * @param subject Subject line.
 * @param html HTML body.
 * @param sender Mailbox to send from; defaults to CONFIG.mail.nikolausSender.
 * @param replyTo Where replies go instead of the sender, e.g. a visitor of the contact form.
 * @throws Propagates mail client setup, authentication, and Graph request errors.
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

/** A file attached to a mail. */
export interface MailAttachment {
  name: string;
  contentType: string;
  content: Uint8Array;
}

/** Graph rejects a sendMail request above 4 MB; attachments grow by a third in base64. */
export const MAX_MAIL_ATTACHMENT_BYTES = 2.5 * 1024 * 1024;

/**
 * Sends one HTML e-mail to many recipients in blind copy, so they do not see each other's
 * addresses. The mail goes to the sender itself, which also keeps a copy in Sent Items.
 * Requires the application permission `Mail.Send` for the sender mailbox.
 * @throws Propagates authentication and Graph request errors.
 */
export async function sendBlindCopyMail(options: {
  sender: string;
  bcc: string[];
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}): Promise<void> {
  const attachments = options.attachments ?? [];
  await getClient()
    .api(`/users/${encodeURIComponent(options.sender)}/sendMail`)
    .post({
      message: {
        subject: options.subject,
        body: { contentType: 'HTML', content: options.html },
        toRecipients: [{ emailAddress: { address: options.sender } }],
        bccRecipients: options.bcc.map((address) => ({ emailAddress: { address } })),
        ...(attachments.length > 0
          ? {
              attachments: attachments.map((attachment) => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: attachment.name,
                contentType: attachment.contentType,
                contentBytes: Buffer.from(attachment.content).toString('base64'),
              })),
            }
          : {}),
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
