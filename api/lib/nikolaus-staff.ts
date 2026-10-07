import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { NikolausSettings } from './nikolaus-config';
import type { ClientPrincipal } from './staff-auth';
import { isStaffError, requireStaff } from './staff-auth';
import { getNikolausSettings } from './nikolaus-settings';
import { errorResponse } from './response-utils';

/** The internal Nikolaus modules are switched off in the Steuerung. */
export const NIKOLAUS_STAFF_INACTIVE = errorResponse(
  403,
  'NIKOLAUS_INACTIVE',
  'Die Nikolausverwaltung ist ausgeschaltet. Sie lässt sich im Modul „Steuerung“ wieder einschalten.'
);

export interface NikolausStaffAccess {
  principal: ClientPrincipal;
  config: NikolausSettings;
}

/**
 * Like `requireStaff`, and the internal Nikolaus modules must be switched on. Every
 * `intern/nikolaus/*` endpoint except the Steuerung starts with it.
 */
export async function requireNikolausStaff(
  request: HttpRequest
): Promise<NikolausStaffAccess | HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  const config = await getNikolausSettings();
  if (!config.staffActive) return NIKOLAUS_STAFF_INACTIVE;
  return { principal, config };
}

export function isNikolausStaffError(
  value: NikolausStaffAccess | HttpResponseInit
): value is HttpResponseInit {
  return !('config' in value);
}
