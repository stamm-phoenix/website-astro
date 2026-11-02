import { CONFIG } from './config';
import { escapeHtml, sendMail } from './mail';
import { mailLayout } from './mail-template';
import { SCHNUPPER_STUFE_LABELS } from './schnupper-model';
import type { StaffSchnupperAnfrage } from './schnupper-model';

/**
 * Mails of the Schnupperstunden-Anfragen (#139): a note to the Stamm about a new request, the
 * receipt to the family and the answer (confirmed date or cancellation). All go out from the
 * contact mailbox, so a reply of the family arrives there.
 */

interface Mail {
  subject: string;
  html: string;
}

const MODULE_PATH = '/leitendenbereich/schnupperanfragen';

function paragraphs(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br />');
}

function stufeLabel(anfrage: StaffSchnupperAnfrage): string {
  return SCHNUPPER_STUFE_LABELS[anfrage.stufe];
}

/** „Schnupperstunde für Mia (8 Jahre)“ or „Schnupperstunde (8 Jahre)“. */
function wofuer(anfrage: StaffSchnupperAnfrage): string {
  const kind = anfrage.kindVorname ? ` für ${anfrage.kindVorname}` : '';
  return `Schnupperstunde${kind} (${anfrage.alter} Jahre)`;
}

/** „Dienstag, 12. November 2026“ for a `YYYY-MM-DD` date. */
export function formatSchnupperDatum(datum: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${datum}T00:00:00Z`));
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;vertical-align:top;">${label}</td><td>${value}</td></tr>`;
}

/** Note to the Stamm about a new request, with a link to the module. */
export function schnupperStammMail(anfrage: StaffSchnupperAnfrage, siteUrl: string): Mail {
  const rows = [
    row('Alter', `${anfrage.alter} Jahre`),
    row('Stufe', escapeHtml(stufeLabel(anfrage))),
    anfrage.kindVorname ? row('Kind', escapeHtml(anfrage.kindVorname)) : '',
    row('Wunschzeit', paragraphs(anfrage.wunschzeit)),
    row('Von', escapeHtml(anfrage.name)),
    row(
      'E-Mail',
      `<a href="mailto:${escapeHtml(anfrage.email)}" style="color:#003056;">${escapeHtml(anfrage.email)}</a>`
    ),
    anfrage.telefon ? row('Telefon', escapeHtml(anfrage.telefon)) : '',
  ].join('');
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Neue Anfrage für eine Schnupperstunde</h1>
    <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px;">${rows}</table>
    ${
      anfrage.nachricht
        ? `<div style="margin:16px 0;padding:12px 16px;border-left:4px solid #810a1a;background:#faf7f2;">${paragraphs(anfrage.nachricht)}</div>`
        : ''
    }
    <p><a href="${escapeHtml(siteUrl + MODULE_PATH)}" style="color:#003056;font-weight:bold;">Termin bestätigen oder absagen</a></p>
    <p style="font-size:13px;color:#6b7280;">Die E-Mail-Adresse wurde nicht überprüft.</p>`);
  return {
    subject: `Schnupperanfrage: ${stufeLabel(anfrage)}, ${anfrage.alter} Jahre – ${anfrage.name}`,
    html,
  };
}

/** Receipt to the family: the request arrived and is open. */
export function schnupperEingangMail(anfrage: StaffSchnupperAnfrage): Mail {
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Deine Anfrage ist bei uns angekommen</h1>
    <p>Hallo ${escapeHtml(anfrage.name)},</p>
    <p>danke für deine Anfrage für eine ${escapeHtml(wofuer(anfrage))}.</p>
    <p><strong>Stand: offen.</strong> Unsere Leitenden schauen nach einem passenden Termin. Du bekommst
      eine zweite E-Mail, sobald der Termin feststeht. Da wir alle ehrenamtlich dabei sind, kann das
      ein paar Tage dauern.</p>
    <p>Hast du keine Anfrage geschickt? Dann hat jemand deine Adresse auf stamm-phoenix.de angegeben.
      Du kannst diese E-Mail einfach ignorieren.</p>
    <p>Gut Pfad<br />DPSG Stamm Phoenix</p>`);
  return { subject: 'Deine Anfrage für eine Schnupperstunde', html };
}

/** Answer to the family with the confirmed date. */
export function schnupperBestaetigtMail(anfrage: StaffSchnupperAnfrage): Mail {
  const termin = anfrage.termin;
  if (!termin) throw new Error('Schnupperanfrage has no confirmed date');
  const rows = [
    row(
      'Wann',
      `${escapeHtml(formatSchnupperDatum(termin.datum))}, ${escapeHtml(termin.zeit)} Uhr`
    ),
    termin.ort ? row('Wo', escapeHtml(termin.ort)) : '',
    row('Stufe', escapeHtml(stufeLabel(anfrage))),
  ].join('');
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Deine Schnupperstunde ist bestätigt</h1>
    <p>Hallo ${escapeHtml(anfrage.name)},</p>
    <p><strong>Stand: Termin bestätigt.</strong> Wir freuen uns auf die ${escapeHtml(wofuer(anfrage))}.</p>
    <table style="border-collapse:collapse;font-size:14px;margin:16px 0;">${rows}</table>
    ${anfrage.antwort ? `<p>${paragraphs(anfrage.antwort)}</p>` : ''}
    <p>Passt der Termin doch nicht? Antworte einfach auf diese E-Mail.</p>
    <p>Gut Pfad<br />DPSG Stamm Phoenix</p>`);
  return {
    subject: `Schnupperstunde am ${formatSchnupperDatum(termin.datum)} bestätigt`,
    html,
  };
}

/** Answer to the family that no Schnupperstunde takes place. */
export function schnupperAbgesagtMail(anfrage: StaffSchnupperAnfrage): Mail {
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Zu deiner Schnupperstunde</h1>
    <p>Hallo ${escapeHtml(anfrage.name)},</p>
    <p><strong>Stand: abgesagt.</strong> Für deine Anfrage (${escapeHtml(wofuer(anfrage))}) können wir
      leider keinen Termin anbieten.</p>
    ${anfrage.antwort ? `<p>${paragraphs(anfrage.antwort)}</p>` : ''}
    <p>Hast du Fragen? Antworte einfach auf diese E-Mail.</p>
    <p>Gut Pfad<br />DPSG Stamm Phoenix</p>`);
  return { subject: 'Deine Anfrage für eine Schnupperstunde', html };
}

/** @throws Propagates mail client setup, authentication and Graph request errors. */
export async function sendSchnupperStammMail(
  anfrage: StaffSchnupperAnfrage,
  siteUrl: string
): Promise<void> {
  const { mailbox } = CONFIG.kontakt;
  const { subject, html } = schnupperStammMail(anfrage, siteUrl);
  await sendMail(mailbox, subject, html, mailbox, { address: anfrage.email, name: anfrage.name });
}

/** @throws Propagates mail client setup, authentication and Graph request errors. */
export async function sendSchnupperFamilienMail(
  anfrage: StaffSchnupperAnfrage,
  mail: Mail
): Promise<void> {
  const { mailbox } = CONFIG.kontakt;
  await sendMail(anfrage.email, mail.subject, mail.html, mailbox);
}
