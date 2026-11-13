/** The demo login: the principal, the logged-out cookie and the login check of `intern` routes. */
import type { ClientPrincipal } from '../../api/lib/staff-principal-model';
import { error } from './mockCore';
import type { MockRequest, MockResult } from './mockCore';

// ---------------------------------------------------------------------------------------------
// Static Web Apps auth

export const LOGGED_OUT_COOKIE = 'mock_logged_out';

export const PRINCIPAL: ClientPrincipal = {
  identityProvider: 'aad',
  userId: 'mock-0f3c2a7e9b1d4c58',
  userDetails: 'leitung@example.test',
  // Roles of the teams „Leitende“, „Kasse“ and „Vorstand“, as `GetRoles` assigns them at login
  userRoles: ['anonymous', 'authenticated', 'team_leitende', 'team_kasse', 'team_vorstand'],
  claims: [
    { typ: 'name', val: 'Demo Leitung' },
    { typ: 'given_name', val: 'Demo' },
    { typ: 'family_name', val: 'Leitung' },
    { typ: 'preferred_username', val: 'leitung@example.test' },
    { typ: 'tid', val: '0e650e3e-3da0-4a47-bf6c-df3dd3980caa' },
  ],
};

export function isLoggedOut(req: MockRequest): boolean {
  return /(?:^|;\s*)mock_logged_out=1/.test(req.headers.cookie ?? '');
}

export function safeRedirect(target: string | null, fallback: string): string {
  return target && target.startsWith('/') && !target.startsWith('//') ? target : fallback;
}

/** Like `requireStaff`: intern endpoints need a login. */
export function requireLogin(req: MockRequest): MockResult | null {
  return isLoggedOut(req) ? error(401, 'UNAUTHORIZED', 'Bitte melde dich an.') : null;
}
