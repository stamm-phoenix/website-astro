import { CONFIG } from './config';
import { escapeHtml, sendMail } from './mail';
import { mailButton, mailLayout } from './mail-template';
import { taskReminderMailAllowed } from './aufgaben-erinnerung-mails';
import type { Sitzung } from './leitendenrunde-termin';

/** Previews and their fictional minutes never send real mails; same rule as the task reminders. */
export function leitendenrundeMailAllowed(): boolean {
  return taskReminderMailAllowed();
}

/** „Mittwoch, 14.10.2026“ for a calendar day. */
function germanDay(date: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

/** „Mittwoch, 14.10.2026, 19:00 Uhr, im Pfarrheim“ with what is known. */
export function sitzungText(sitzung: Sitzung): string {
  return [
    germanDay(sitzung.date),
    sitzung.time ? `${sitzung.time} Uhr` : '',
    sitzung.place ? `Ort: ${sitzung.place}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** One mail per person: the addresses of the other leaders are not exposed. */
export async function sendLeitendenrundeReminder(
  recipient: string,
  sitzung: Sitzung
): Promise<void> {
  if (!leitendenrundeMailAllowed()) throw new Error('Leitendenrunde mail disabled in previews');
  const when = sitzungText(sitzung);
  const html = mailLayout(`
    <p>Hallo!</p>
    <p>Die nächste Leitendenrunde ist am <strong>${escapeHtml(when)}</strong>.</p>
    ${mailButton(sitzung.url, 'Protokoll öffnen', 'Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:')}
    <p>Gut Pfad!<br>Stamm Phoenix</p>`);
  await sendMail(
    recipient,
    `Erinnerung: Leitendenrunde am ${sitzung.date.split('-').reverse().join('.')}`,
    html,
    CONFIG.leitendenrundeReminders.sender,
    undefined,
    { retry: false, timeoutMs: CONFIG.leitendenrundeReminders.mailTimeoutMs }
  );
}
