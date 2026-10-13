import { app, type Timer, type InvocationContext } from '@azure/functions';
import { EnvironmentVariable, findEnvironment } from '../lib/environment';
import { runTaskReminderWorker } from '../lib/task-reminder-worker';

/** Separate Function App entry point: the SWA HTTP app never registers this timer. */
export async function taskReminderTimer(_timer: Timer, context: InvocationContext): Promise<void> {
  if (findEnvironment(EnvironmentVariable.TASK_REMINDERS_ENABLED) !== 'true') {
    context.log('[task-reminders] disabled');
    return;
  }
  try {
    await runTaskReminderWorker((result) =>
      context.log('[task-reminders]', JSON.stringify(result))
    );
  } catch (error) {
    // Avoid storing SQL details, credentials, recipients or task content in host exception logs.
    context.error('[task-reminders] failed', error instanceof Error ? error.name : 'UnknownError');
    // eslint-disable-next-line preserve-caught-error -- Raw causes can expose SQL or personal data in host logs.
    throw new Error('Task reminder execution failed; inspect the outcome counters');
  }
}
app.timer('taskReminders', {
  schedule: '0 17 * * * *',
  useMonitor: true,
  runOnStartup: false,
  handler: taskReminderTimer,
});
