/** Scheduled main workflow calls the API with its short-lived GitHub identity; never loads mail credentials. */
import { CONFIG } from '../lib/config';

async function token(): Promise<string> {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) throw new Error('GitHub OIDC identity is required');
  const url = new URL(requestUrl);
  url.searchParams.set('audience', CONFIG.taskReminders.oidcAudience);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`OIDC request failed (${response.status})`);
  const body = (await response.json()) as { value?: unknown };
  if (typeof body.value !== 'string' || !body.value) throw new Error('Missing OIDC token');
  return body.value;
}
async function main(): Promise<void> {
  let uncertain = 0;
  let remaining = 0;
  let retryable = 0;
  for (let batch = 0; batch < CONFIG.taskReminders.maxBatches; batch++) {
    const response = await fetch(
      `${CONFIG.taskReminders.apiUrl}/api/automation/aufgaben-erinnerungen`,
      {
        method: 'POST',
        headers: {
          'x-task-reminder-token': await token(),
          'User-Agent': 'stamm-phoenix-task-reminders',
        },
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      }
    );
    if (!response.ok) throw new Error(`Task reminders failed (${response.status})`);
    const result = (await response.json()) as {
      day?: unknown;
      sent?: unknown;
      uncertain?: unknown;
      remaining?: unknown;
      retryable?: unknown;
      reason?: unknown;
    };
    if (
      typeof result.sent !== 'number' ||
      typeof result.uncertain !== 'number' ||
      typeof result.remaining !== 'number'
    )
      throw new Error('Invalid reminder response');
    console.log(JSON.stringify(result));
    uncertain += result.uncertain;
    remaining = result.remaining;
    if (typeof result.retryable === 'number') retryable += result.retryable;
    if (!remaining || retryable) break;
  }
  if (uncertain)
    throw new Error(
      `${uncertain} reminder deliveries unconfirmed; check the sender mailbox. No automatic resend.`
    );
  if (retryable)
    throw new Error(`${retryable} reminder deliveries rejected; retry on the next scheduled run.`);
  if (remaining) throw new Error('Reminder backlog remains; the next scheduled run will continue.');
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Task reminders failed');
  process.exitCode = 1;
});
