import { app, type Timer, type InvocationContext } from '@azure/functions';
import { raeumeAuf } from '../lib/essen-aufbewahrung';
import { EnvironmentVariable, findEnvironment } from '../lib/environment';

/**
 * Daily retention of the Essensplanung (`docs/essensplanung.md`), in the separate Function App
 * of the timers (`docs/aufgaben-timer.md`); the SWA HTTP app never registers it.
 */
export async function essensplanungAufbewahrungTimer(
  _timer: Timer,
  context: InvocationContext
): Promise<void> {
  if (findEnvironment(EnvironmentVariable.ESSENSPLANUNG_AUFBEWAHRUNG_ENABLED) !== 'true') {
    context.log('[essensplanung-aufbewahrung] disabled');
    return;
  }
  try {
    context.log('[essensplanung-aufbewahrung]', JSON.stringify(await raeumeAuf()));
  } catch (error) {
    // Avoid storing SQL details, addresses or names in host exception logs.
    context.error(
      '[essensplanung-aufbewahrung] failed',
      error instanceof Error ? error.name : 'UnknownError'
    );
    // eslint-disable-next-line preserve-caught-error -- Raw causes can expose SQL or personal data in host logs.
    throw new Error('Essensplanung retention failed');
  }
}

app.timer('essensplanungAufbewahrung', {
  schedule: '0 23 3 * * *',
  useMonitor: true,
  runOnStartup: false,
  handler: essensplanungAufbewahrungTimer,
});
