import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ClientPrincipalClaim } from '../lib/staff-auth';
import type { ReadMemberGroups } from '../lib/staff-roles';
import { getTeamRoles, readMemberGroups } from '../lib/staff-roles';

interface LoginUser {
  identityProvider: string;
  userDetails: string;
  claims?: ClientPrincipalClaim[];
}

function readLoginUser(body: unknown): LoginUser | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const user = body as Record<string, unknown>;
  if (typeof user.identityProvider !== 'string' || typeof user.userDetails !== 'string')
    return undefined;
  const claims = Array.isArray(user.claims)
    ? user.claims.filter(
        (claim): claim is ClientPrincipalClaim =>
          !!claim &&
          typeof claim === 'object' &&
          typeof (claim as Record<string, unknown>).typ === 'string' &&
          typeof (claim as Record<string, unknown>).val === 'string'
      )
    : undefined;
  return { identityProvider: user.identityProvider, userDetails: user.userDetails, claims };
}

/**
 * `rolesSource` of staticwebapp.config.json: Static Web Apps posts the user after every login
 * and stores the returned roles in the session. Once configured, Static Web Apps refuses
 * external requests to it. Without an answer from Graph the user gets no team roles and sees
 * the „Kein Zugang“ page, which offers a new login.
 */
export function createGetRolesEndpoint(read: ReadMemberGroups = readMemberGroups) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    if (request.method !== 'POST') return { status: 405 };
    const user = readLoginUser(await request.json().catch(() => undefined));
    if (!user) return { status: 200, jsonBody: { roles: [] } };
    try {
      return { status: 200, jsonBody: { roles: await getTeamRoles(user, read) } };
    } catch (error: unknown) {
      context.error('[rollen] Teams konnten nicht gelesen werden', error);
      return { status: 200, jsonBody: { roles: [] } };
    }
  };
}

export const GetRoles = createGetRolesEndpoint();
