import { CONFIG } from './config';
import { escapeHtml, sendMail } from './mail';
import { mailButton, mailLayout } from './mail-template';
import type { PostfachEintrag } from './postfach-liste';
import type { KonversationZeile } from './postfach-model';

/**
 * The note to a person who was made responsible for a conversation. It goes to the person's
 * own account and holds only subject and sender, not the text of the mail: that stays in the
 * mailbox and is read in the Leitendenbereich or in Outlook.
 */

interface Mail {
  subject: string;
  html: string;
}

/** The page of the mailbox with the conversation open (`#konversation=`, `web/src/lib/postfachAnsicht.ts`). */
export function konversationLink(siteUrl: string, postfach: string, konversation: string): string {
  return `${siteUrl}/leitendenbereich/email/${postfach}#konversation=${encodeURIComponent(konversation)}`;
}

function datum(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso));
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;vertical-align:top;">${label}</td><td>${value}</td></tr>`;
}

export function zuweisungMail(
  postfach: PostfachEintrag,
  konversation: KonversationZeile,
  vonName: string,
  siteUrl: string
): Mail {
  const absender = konversation.von.adresse
    ? `${escapeHtml(konversation.von.name)} &lt;${escapeHtml(konversation.von.adresse)}&gt;`
    : escapeHtml(konversation.von.name);
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Du bist zuständig für eine E-Mail</h1>
    <p>${escapeHtml(vonName)} hat dir eine E-Mail im ${escapeHtml(postfach.name)} (${escapeHtml(postfach.address)}) zugewiesen.</p>
    <table style="border-collapse:collapse;font-size:14px;margin:16px 0;">
      ${row('Betreff', escapeHtml(konversation.betreff))}
      ${row('Von', absender)}
      ${row('Eingegangen', escapeHtml(datum(konversation.am)))}
    </table>
    ${mailButton(
      konversationLink(siteUrl, postfach.id, konversation.id),
      'E-Mail ansehen',
      'Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:'
    )}`);
  return { subject: `Dir zugewiesen: ${konversation.betreff}`, html };
}

/** Sends the note; the caller decides what a failure means. A seam for the tests. */
export const postfachBenachrichtigung = { senden: sendeZuweisungMail };

async function sendeZuweisungMail(
  an: string,
  postfach: PostfachEintrag,
  konversation: KonversationZeile,
  vonName: string,
  siteUrl: string
): Promise<void> {
  const mail = zuweisungMail(postfach, konversation, vonName, siteUrl);
  await sendMail(an, mail.subject, mail.html, CONFIG.postfaecher.sender, undefined, {
    retry: false,
    timeoutMs: 10_000,
  });
}
