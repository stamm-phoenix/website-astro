import type { HttpRequest } from '@azure/functions';
import { app } from '@azure/functions';
import { ok } from '../lib/pflege-api';
import { readJsonBody } from '../lib/response-utils';
import { getStaffUsage, recordStaffUsage } from '../lib/staff-usage';
import { validateStaffUsage } from '../lib/validation/staff-usage';
import { staffHandler } from '../lib/handler';

export const StaffUsage = staffHandler(
  'haeufig',
  async (request: HttpRequest) => {
    if (request.method === 'GET') return ok({ counts: await getStaffUsage() });
    await recordStaffUsage(validateStaffUsage(await readJsonBody(request)));
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
