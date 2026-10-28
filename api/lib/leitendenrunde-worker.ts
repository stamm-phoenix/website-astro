import { runLeitendenrundeReminders, type LeitendenrundeResult } from './leitendenrunde-erinnerung';

/** One run inside Azure; anything that needs a look makes the execution fail, so it shows up in the alarms. */
export async function runLeitendenrundeWorker(
  report: (result: LeitendenrundeResult) => void,
  now = new Date()
): Promise<void> {
  const result = await runLeitendenrundeReminders(now, { deadline: Date.now() + 8 * 60_000 });
  report(result);
  if (
    result.failed ||
    result.uncertain ||
    result.retryable ||
    result.remaining ||
    result.missingAddress ||
    result.reason === 'no-recipients'
  )
    throw new Error(
      `Leitendenrunde reminder outcome: failed=${result.failed}, uncertain=${result.uncertain}, retryable=${result.retryable}, remaining=${result.remaining}, missingAddress=${result.missingAddress}, reason=${result.reason ?? 'none'}`
    );
}
