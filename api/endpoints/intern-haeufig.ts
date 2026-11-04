import type { HttpRequest } from '@azure/functions';
import { app } from '@azure/functions';
import { METHOD_NOT_ALLOWED, ok, pflegeHandler, readJsonBody } from '../lib/pflege-api';
import { withErrorHandling } from '../lib/response-utils';
import { getStaffUsage, recordStaffUsage } from '../lib/staff-usage';
import { validateStaffUsage } from '../lib/validation/staff-usage';

export const StaffUsage = withErrorHandling(
  pflegeHandler(
    'haeufig',
    async (request: HttpRequest) => {
      if (request.method === 'GET') return ok({ counts: await getStaffUsage() });
      if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
      await recordStaffUsage(validateStaffUsage(await readJsonBody(request)));
      return ok({});
    },
    { quiet: true }
  )
);

app.http('StaffUsage', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/haeufig',
  handler: StaffUsage,
});
