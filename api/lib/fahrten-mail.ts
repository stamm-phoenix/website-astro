import { CONFIG } from './config';
import type { CampflowEvent, CampflowPerson } from './campflow';
import { escapeHtml, sendMail } from './mail';
import type { MailReplyTo } from './mail';
import { mailLayout, mailMessageBlock } from './mail-template';
import { ValidationError } from './validation/errors';
import type { FahrtenMailInput } from './validation/fahrten';
import type { FahrtenMailErgebnis } from './fahrten-mail-model';

/** One mail to the family or Leitende behind a driving registration. */
export interface FahrtenMail {
  fahrerId: string;
  name: string;
  /** Primary address first, then the further addresses of the registration. */
  to: string[];
  subject: string;
  html: string;
}

const FAHRT_LABEL = { hin: 'Hinfahrt', rueck: 'Rückfahrt' } as const;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function personName(person: CampflowPerson): string {
  const name = record(person.name);
  const full = [text(name.first_name), text(name.last_name)].filter(Boolean).join(' ');
  return full || text(person.name) || '(ohne Namen)';
}

function addresses(person: CampflowPerson): string[] {
  const cc = Array.isArray(person.cc_emails) ? person.cc_emails : [];
  const all = [person.primary_email, ...cc].map(text).filter((value) => EMAIL.test(value));
  return all.filter(
    (value, index) =>
      all.findIndex((other) => other.toLowerCase() === value.toLowerCase()) === index
  );
}

function phones(person: CampflowPerson): string {
  const list = Array.isArray(person.phone_numbers) ? person.phone_numbers : [];
  return list
    .map(record)
    .filter((phone) => text(phone.number))
    .map((phone) =>
      text(phone.label) ? `${text(phone.number)} (${text(phone.label)})` : text(phone.number)
    )
    .join(', ');
}

function formatDay(date: string | null): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return '';
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  });
}

function eventRange(event: CampflowEvent): string {
  const start = formatDay(event.start_date);
  const end = formatDay(event.end_date);
  return end && end !== start ? `${start} – ${end}` : start;
}

/** Plain text of the leader, with its line breaks kept. */
function nachrichtHtml(nachricht: string): string {
  return nachricht
    .split(/\n{2,}/)
    .map((absatz) => `<p>${escapeHtml(absatz.trim()).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function mitfahrendeHtml(mitfahrende: CampflowPerson[]): string {
  if (mitfahrende.length === 0) {
    return '<p style="margin:4px 0 0;">Niemand fährt bei dir mit.</p>';
  }
  const items = mitfahrende
    .map((person) => {
      const telefon = phones(person);
      return `<li style="margin:0 0 4px;">${escapeHtml(personName(person))}${
        telefon ? ` · ${escapeHtml(telefon)}` : ''
      }</li>`;
    })
    .join('');
  return `<ul style="margin:4px 0 0;padding-left:20px;">${items}</ul>`;
}

/**
 * The mails to the drivers of a plan, one per driving registration, with the passengers of
 * each direction. Ids that are not an active registration of the Aktion are refused.
 */
export function fahrtenMails(
  event: CampflowEvent,
  persons: CampflowPerson[],
  input: FahrtenMailInput,
  /** First name of the leader who sends, for the greeting at the end. */
  absender: string
): { mails: FahrtenMail[]; ohneAdresse: string[] } {
  const active = new Map(
    persons.filter((person) => !text(person.cancellation_date)).map((p) => [p.id, p])
  );
  const lookup = (id: string): CampflowPerson => {
    const person = active.get(id);
    if (!person) {
      throw new ValidationError({
        form: 'Der Plan passt nicht mehr zu den Anmeldungen in CampFlow. Bitte lade die Seite neu und prüf den Plan.',
      });
    }
    return person;
  };

  const fahrerIds: string[] = [];
  for (const auto of [...input.fahrten.hin, ...input.fahrten.rueck]) {
    if (!fahrerIds.includes(auto.fahrer)) fahrerIds.push(auto.fahrer);
  }
  const range = eventRange(event);
  const mails: FahrtenMail[] = [];
  const ohneAdresse: string[] = [];
  for (const fahrerId of fahrerIds) {
    const fahrer = lookup(fahrerId);
    const name = personName(fahrer);
    const abschnitte = (['hin', 'rueck'] as const).map((fahrt) => {
      const auto = input.fahrten[fahrt].find((a) => a.fahrer === fahrerId);
      const inhalt = auto
        ? mitfahrendeHtml(auto.mitfahrende.map(lookup))
        : '<p style="margin:4px 0 0;">Du fährst nicht.</p>';
      return `<h2 style="margin:20px 0 0;font-size:16px;color:#003056;">${FAHRT_LABEL[fahrt]}</h2>${inhalt}`;
    });
    const to = addresses(fahrer);
    if (to.length === 0) {
      ohneAdresse.push(name);
      continue;
    }
    mails.push({
      fahrerId,
      name,
      to,
      subject: `Fahrt zu „${event.title}“: Auto von ${name}`,
      html: mailLayout(`
    <h1 style="margin:0 0 12px;font-size:20px;color:#003056;">Danke, dass du fährst!</h1>
    <p>Hier ist die Planung für das Auto von <strong>${escapeHtml(name)}</strong> zu „${escapeHtml(
      event.title
    )}“${range ? ` (${escapeHtml(range)})` : ''}.</p>
    ${input.nachricht ? mailMessageBlock(nachrichtHtml(input.nachricht)) : ''}
    ${abschnitte.join('\n    ')}
    <p style="margin-top:24px;">Wenn etwas nicht passt, antworte einfach auf diese Mail.</p>
    <p>Gut Pfad<br />${escapeHtml(absender)}<br />DPSG Stamm Phoenix</p>`),
    });
  }
  return { mails, ohneAdresse };
}

const PARALLEL_MAILS = 4;

/** Sends the mails a few at a time; one failed mail does not stop the others. */
export async function sendFahrtenMails(
  mails: FahrtenMail[],
  replyTo: MailReplyTo | undefined,
  onError: (error: unknown) => void
): Promise<Pick<FahrtenMailErgebnis, 'gesendet' | 'fehlgeschlagen'>> {
  const gesendet: string[] = [];
  const fehlgeschlagen: FahrtenMailErgebnis['fehlgeschlagen'] = [];
  for (let start = 0; start < mails.length; start += PARALLEL_MAILS) {
    await Promise.all(
      mails.slice(start, start + PARALLEL_MAILS).map(async (mail) => {
        try {
          await sendMail(mail.to, mail.subject, mail.html, CONFIG.mail.fahrtenSender, replyTo, {
            retry: false,
            timeoutMs: 8000,
          });
          gesendet.push(mail.name);
        } catch (error: unknown) {
          onError(error);
          fehlgeschlagen.push({ id: mail.fahrerId, name: mail.name });
        }
      })
    );
  }
  return { gesendet, fehlgeschlagen };
}
