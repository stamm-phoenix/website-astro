import { withErrorHandling, errorResponse } from '../lib/response-utils';
import { verifyTaskReminderToken } from '../lib/github-reminder-auth';
import { runTaskReminders } from '../lib/aufgaben-erinnerungen';
import { ok, METHOD_NOT_ALLOWED } from '../lib/pflege-api';

/** Machine route outside /intern: it requires a signed, narrowly scoped scheduled-workflow identity. */
export const TaskReminderEndpoint = withErrorHandling(async (request, context) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  if (!(await verifyTaskReminderToken(request.headers.get('x-task-reminder-token'))))
    return errorResponse(401, 'UNAUTHORIZED', 'Nicht erlaubt.');
  const result = await runTaskReminders();
  context.log('[aufgaben-erinnerungen]', JSON.stringify(result));
  return ok(result);
});
