import type { HttpRequest } from '@azure/functions';
import { app } from '@azure/functions';
import { ok } from '../lib/pflege-api';
import { readJsonBody } from '../lib/response-utils';
import { getStaffUsage, recordStaffUsage } from '../lib/staff-usage';
import { validateStaffUsage } from '../lib/validation/staff-usage';
import { staffHandler } from '../lib/handler';
import { MODULE_OPENED, trackStaffEvent } from '../lib/usage-telemetry';

export const StaffUsage = staffHandler(
  'haeufig',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') return ok({ counts: await getStaffUsage() });
    const module = validateStaffUsage(await readJsonBody(request));
    // The anonymous counter of the start page and the pseudonymous event of the statistics
    await Promise.all([
      recordStaffUsage(module),
      trackStaffEvent(MODULE_OPENED, principal, { module }),
    ]);
    return ok({});
  },
  { quiet: true }
);

app.http('StaffUsage', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/haeufig',
  handler: StaffUsage,
});
