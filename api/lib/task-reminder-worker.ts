import { CONFIG } from './config';
import { runTaskReminders, type ReminderResult } from './aufgaben-erinnerungen';

/** Drain small batches inside Azure; keep ambiguous deliveries reserved and never auto-resend. */
export async function runTaskReminderWorker(
  report: (result: ReminderResult) => void,
  now = new Date()
): Promise<void> {
  const deadline = Date.now() + 8 * 60_000;
  let uncertain = 0;
  let retryable = 0;
  let failed = 0;
  let remaining = 0;
  for (let batch = 0; batch < CONFIG.taskReminders.maxBatches; batch++) {
    if (Date.now() >= deadline) throw new Error('Task reminder runtime budget exhausted');
    const result = await runTaskReminders(now);
    report(result);
    uncertain += result.uncertain;
    retryable += result.retryable;
    failed += result.failed;
    remaining = result.remaining;
    if (!remaining) break;
  }
  if (failed || uncertain || retryable || remaining)
    throw new Error(
      `Task reminder outcome: failed=${failed}, uncertain=${uncertain}, retryable=${retryable}, remaining=${remaining}`
    );
}
