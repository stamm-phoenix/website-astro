import { getClient } from './token';
import { EnvironmentVariable, getEnvironment } from './environment';

/**
 * Sends an HTML e-mail via Microsoft Graph from the configured sender mailbox.
 * Requires the application permission `Mail.Send` for the app registration.
 * @param to Recipient e-mail address.
 * @param subject Subject line.
 * @param html HTML body.
 */
export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const client = getClient();

  const NIKOLAUS_MAIL_SENDER = getEnvironment(EnvironmentVariable.NIKOLAUS_MAIL_SENDER);

  await client.api(`/users/${encodeURIComponent(NIKOLAUS_MAIL_SENDER)}/sendMail`).post({
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: to } }],
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
