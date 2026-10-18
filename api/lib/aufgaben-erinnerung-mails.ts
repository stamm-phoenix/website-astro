import { CONFIG } from './config';
import { PREVIEW_DATABASE } from './deployment';
import { escapeHtml, sendMail } from './mail';
import type { Task } from './aufgaben-model';

/** Neither preview databases nor their fictional assignments may send reminder mails. */
export function taskReminderMailAllowed(): boolean {
  return PREVIEW_DATABASE === null && CONFIG.database.server !== CONFIG.database.previewServer;
}

/** One private summary per person; other assignees and their addresses are not exposed. */
export async function sendTaskReminderMail(
  recipient: string,
  tasks: Task[],
  today: string
): Promise<void> {
  if (!taskReminderMailAllowed()) throw new Error('Task reminder mail disabled in previews');
  const items = tasks.map((task) => {
    const date = new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${task.dueDate}T12:00:00Z`));
    const url = `${CONFIG.taskReminders.siteUrl}/leitendenbereich/aufgaben#aufgabe-${task.id}`;
    return `<li><p><strong><a href="${escapeHtml(url)}">${escapeHtml(task.title)}</a></strong><br>${task.dueDate === today ? 'Heute' : 'Morgen'} fällig · ${date}${task.project ? `<br>Projekt: ${escapeHtml(task.project)}` : ''}</p></li>`;
  });
  const html = `<p>Hallo!</p><p>Diese offenen Aufgaben sind dir zugewiesen und werden heute oder morgen fällig:</p><ul>${items.join('')}</ul><p><a href="${escapeHtml(CONFIG.taskReminders.siteUrl)}/leitendenbereich/aufgaben">Aufgaben öffnen</a> und fertige Aufgaben als erledigt markieren.</p><p>Gut Pfad!<br>Stamm Phoenix</p>`;
  await sendMail(
    recipient,
    `Erinnerung: ${tasks.length} ${tasks.length === 1 ? 'Aufgabe' : 'Aufgaben'}`,
    html,
    CONFIG.taskReminders.sender,
    undefined,
    { retry: false, timeoutMs: CONFIG.taskReminders.mailTimeoutMs }
  );
}
