import { escapeHtml, sendMail } from './mail';
import { mailButton, mailLayout } from './mail-template';
import type { PostfachEintrag } from './postfach-liste';
import type { KonversationZeile } from './postfach-model';

/**
 * The note to a person who was made responsible for a conversation. It goes to the person's
 * own account and holds only subject and sender, not the text of the mail: that stays in the
 * mailbox and is read in the Leitendenbereich or in Outlook.
 *
 * It is sent from the mailbox itself and not kept in its Sent Items: subject and sender of a
 * mailbox of the Vorstand must not land in a mailbox other people can open.
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

/** One note for several conversations at once, so a choice of ten does not send ten mails. */
export function zuweisungenMail(
  postfach: PostfachEintrag,
  konversationen: readonly KonversationZeile[],
  vonName: string,
  siteUrl: string
): Mail {
  if (konversationen.length === 1)
    return zuweisungMail(postfach, konversationen[0], vonName, siteUrl);
  const zeilen = konversationen
    .map(
      (konversation) =>
        `<li style="margin:0 0 8px;"><a href="${escapeHtml(konversationLink(siteUrl, postfach.id, konversation.id))}" style="color:#003056;font-weight:bold;">${escapeHtml(konversation.betreff)}</a><br /><span style="color:#6b7280;">${escapeHtml(konversation.von.name)} · ${escapeHtml(datum(konversation.am))}</span></li>`
    )
    .join('');
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Du bist zuständig für ${konversationen.length} E-Mails</h1>
    <p>${escapeHtml(vonName)} hat dir ${konversationen.length} E-Mails im ${escapeHtml(postfach.name)} (${escapeHtml(postfach.address)}) zugewiesen.</p>
    <ul style="padding-left:20px;margin:16px 0;font-size:14px;">${zeilen}</ul>
    ${mailButton(
      `${siteUrl}/leitendenbereich/email/${postfach.id}`,
      'Postfach öffnen',
      'Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:'
    )}`);
  return {
    subject: `Dir zugewiesen: ${konversationen.length} E-Mails im ${postfach.name}`,
    html,
  };
}

/** Sends the note; the caller decides what a failure means. A seam for the tests. */
export const postfachBenachrichtigung = { senden: sendeZuweisungMail };

async function sendeZuweisungMail(
  an: string,
  postfach: PostfachEintrag,
  konversationen: readonly KonversationZeile[],
  vonName: string,
  siteUrl: string
): Promise<void> {
  const mail = zuweisungenMail(postfach, konversationen, vonName, siteUrl);
  await sendMail(an, mail.subject, mail.html, postfach.address, undefined, {
    retry: false,
    timeoutMs: 10_000,
    saveToSentItems: false,
  });
}
