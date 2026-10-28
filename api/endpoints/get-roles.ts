import { z } from 'zod';
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ClientPrincipalClaim } from '../lib/staff-auth';
import type { ReadMemberGroups } from '../lib/staff-roles';
import { getTeamRoles, readMemberGroups } from '../lib/staff-roles';

interface LoginUser {
  identityProvider: string;
  userDetails: string;
  claims?: ClientPrincipalClaim[];
}

const claimSchema = z.looseObject({ typ: z.string(), val: z.string() });

const loginUserSchema = z.object({
  identityProvider: z.string(),
  userDetails: z.string(),
  // Claims that are no text pairs are left out; without a list the login is used instead
  claims: z
    .unknown()
    .optional()
    .transform((claims): ClientPrincipalClaim[] | undefined =>
      Array.isArray(claims)
        ? claims.flatMap((claim) => {
            const parsed = claimSchema.safeParse(claim);
            return parsed.success ? [parsed.data] : [];
          })
        : undefined
    ),
});

function readLoginUser(body: unknown): LoginUser | undefined {
  const user = loginUserSchema.safeParse(body);
  return user.success ? user.data : undefined;
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
