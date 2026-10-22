import { CONFIG } from './config';
import type { ClientPrincipal } from './staff-auth';
import { getClaim, isPreviewDeployment, isPreviewOnlyLogin } from './staff-auth';
import { getClient } from './token';

const OBJECT_ID_CLAIMS = ['oid', 'http://schemas.microsoft.com/identity/claims/objectidentifier'];
const TENANT_CLAIM_TYPES = ['tid', 'http://schemas.microsoft.com/identity/claims/tenantid'];

/** Reads which of the groups the user belongs to, nested memberships included. */
export type ReadMemberGroups = (user: string, groupIds: string[]) => Promise<string[]>;

/** Microsoft Graph `checkMemberGroups` with the API's app registration (`GroupMember.Read.All`). */
export const readMemberGroups: ReadMemberGroups = async (user, groupIds) => {
  const response: unknown = await getClient()
    .api(`/users/${encodeURIComponent(user)}/checkMemberGroups`)
    .option('signal', AbortSignal.timeout(5000))
    .post({ groupIds });
  if (
    !response ||
    typeof response !== 'object' ||
    !('value' in response) ||
    !Array.isArray(response.value)
  )
    throw new Error('Invalid checkMemberGroups response');
  return response.value.filter((id): id is string => typeof id === 'string');
};

function allRoles(): string[] {
  return Object.values(CONFIG.staff.teams).map((team) => team.role);
}

/**
 * The roles of Static Web Apps for the teams the user belongs to in Microsoft Teams. Accounts
 * of other tenants get none; test accounts for PR previews get every role there and none
 * elsewhere, so they can try every module without being in a team.
 */
export async function getTeamRoles(
  principal: Pick<ClientPrincipal, 'identityProvider' | 'userDetails' | 'claims'>,
  read: ReadMemberGroups = readMemberGroups
): Promise<string[]> {
  if (principal.identityProvider !== 'aad' || !principal.userDetails) return [];
  const tenantId = getClaim(principal, TENANT_CLAIM_TYPES);
  if (tenantId && tenantId !== CONFIG.azure.tenantId) return [];
  if (isPreviewOnlyLogin(principal.userDetails)) return isPreviewDeployment() ? allRoles() : [];

  const teams = Object.values(CONFIG.staff.teams);
  // The object ID stays when the login is renamed
  const user = getClaim(principal, OBJECT_ID_CLAIMS) ?? principal.userDetails;
  const memberOf = new Set(
    await read(
      user,
      teams.map((team) => team.groupId)
    )
  );
  return teams.filter((team) => memberOf.has(team.groupId)).map((team) => team.role);
}
