import { app, type Timer, type InvocationContext } from '@azure/functions';
import { EnvironmentVariable, findEnvironment } from '../lib/environment';
import { runLeitendenrundeWorker } from '../lib/leitendenrunde-worker';

/** Separate Function App entry point: the SWA HTTP app never registers this timer. */
export async function leitendenrundeReminderTimer(
  _timer: Timer,
  context: InvocationContext
): Promise<void> {
  if (findEnvironment(EnvironmentVariable.LEITENDENRUNDE_REMINDERS_ENABLED) !== 'true') {
    context.log('[leitendenrunde-reminders] disabled');
    return;
  }
  try {
    await runLeitendenrundeWorker((result) =>
      context.log('[leitendenrunde-reminders]', JSON.stringify(result))
    );
  } catch (error) {
    // Avoid storing SQL details, credentials, recipients or minutes in host exception logs.
    context.error(
      '[leitendenrunde-reminders] failed',
      error instanceof Error ? error.name : 'UnknownError'
    );
    // eslint-disable-next-line preserve-caught-error -- Raw causes can expose SQL or personal data in host logs.
    throw new Error('Leitendenrunde reminder execution failed; inspect the outcome counters');
  }
}
app.timer('leitendenrundeReminders', {
  schedule: '0 47 * * * *',
  useMonitor: true,
  runOnStartup: false,
  handler: leitendenrundeReminderTimer,
});
