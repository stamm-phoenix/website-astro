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

export interface NikolausStaffData<T> extends NikolausStaffAccess {
  data: T;
}

/**
 * Like `requireNikolausStaff`, for GET requests: `load` starts together with the settings
 * instead of after them, and its result is only returned while the modules are switched on.
 * `active` resolves with the settings once the gate passed, for reads that need them or must
 * not run while the modules are switched off (e.g. calls to other services).
 */
export async function readAsNikolausStaff<T>(
  request: HttpRequest,
  load: (active: Promise<NikolausSettings>) => Promise<T>
): Promise<NikolausStaffData<T> | HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  const settings = getNikolausSettings();
  const active = settings.then((config) => {
    if (!config.staffActive) throw new Error('The Nikolaus staff modules are switched off');
    return config;
  });
  const data = load(active);
  // Dropped when the gate answers instead; their failure must not end the process
  active.catch(() => undefined);
  data.catch(() => undefined);
  const config = await settings;
  if (!config.staffActive) return NIKOLAUS_STAFF_INACTIVE;
  return { principal, config, data: await data };
}

export function isNikolausStaffError(
  value: NikolausStaffAccess | HttpResponseInit
): value is HttpResponseInit {
  return !('config' in value);
}
