/**
 * Invitation and reminder of an Abstimmung (`docs/abstimmungen.md`): one mail per person, because
 * each carries the personal link with which the person answers without logging in.
 */
import { CONFIG } from './config';
import type { AbstimmungMailArt } from './abstimmung-model';
import { escapeHtml, sendMail } from './mail';
import { mailButton, mailLayout } from './mail-template';

const FALLBACK = 'Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:';

export interface AbstimmungMailDaten {
  art: AbstimmungMailArt;
  /** Name of the person invited, if known from CampFlow. */
  name: string;
  titel: string;
  beschreibung: string;
  /** Name and login of the organizer; replies go to the login. */
  organisatorName: string;
  organisatorLogin: string;
  /** Personal link of the recipient. */
  url: string;
}

/** Subject and text of the mail. */
export function abstimmungMailContent(data: AbstimmungMailDaten): {
  subject: string;
  html: string;
} {
  const erinnerung = data.art === 'erinnerung';
  // An address several CampFlow persons share, e.g. „Ben Bau, Clara Bau“, greets them all
  const familie = data.name.includes(',');
  const vorname = data.name.trim().split(/\s+/)[0] ?? '';
  const anrede = familie ? 'Hallo zusammen' : `Hallo${vorname ? ` ${escapeHtml(vorname)}` : ''}`;
  const beschreibung = data.beschreibung
    ? `<div style="margin:16px 0;padding:12px 16px;border-left:4px solid #810a1a;background:#faf7f2;">${escapeHtml(
        data.beschreibung
      ).replace(/\r?\n/g, '<br />')}</div>`
    : '';
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;">${erinnerung ? 'Erinnerung: ' : ''}${escapeHtml(data.titel)}</h1>
    <p>${anrede},</p>
    <p>${
      erinnerung
        ? `du hast bei der Abstimmung <strong>${escapeHtml(data.titel)}</strong> noch nicht mitgemacht. ${escapeHtml(data.organisatorName)} freut sich über deine Antwort.`
        : `${escapeHtml(data.organisatorName)} lädt dich zur Abstimmung <strong>${escapeHtml(data.titel)}</strong> ein.`
    }</p>
    ${beschreibung}
    ${mailButton(data.url, 'Jetzt abstimmen', FALLBACK)}
    <p style="font-size:13px;color:#6b7280;">${
      familie
        ? 'Mit diesem Link kann jede und jeder von euch abstimmen: Trag einfach deinen eigenen Namen ein.'
        : 'Der Link gehört nur dir: Mit ihm kannst du deine Antwort jederzeit ändern.'
    } Fragen zur Abstimmung? Antworte einfach auf diese Mail.</p>
  `);
  return {
    subject: `${erinnerung ? 'Erinnerung: ' : 'Abstimmung: '}${data.titel}`,
    html,
  };
}

/** Longest wait for one mail; it ends as unclear, never sent again automatically. */
export const ABSTIMMUNG_MAIL_TIMEOUT_MS = 10_000;

/**
 * Sends one invitation or reminder; replies go to the organizer. Without retries and with a
 * time limit, so a step of several mails stays within the time limit of Static Web Apps.
 */
export async function sendAbstimmungMail(to: string, data: AbstimmungMailDaten): Promise<void> {
  const { subject, html } = abstimmungMailContent(data);
  await sendMail(
    to,
    subject,
    html,
    CONFIG.abstimmungen.sender,
    { address: data.organisatorLogin, name: data.organisatorName },
    { retry: false, timeoutMs: ABSTIMMUNG_MAIL_TIMEOUT_MS }
  );
}

/** The mail of this module; a seam for the tests. */
export const abstimmungMail = { send: sendAbstimmungMail };
