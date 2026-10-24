import { addTiming } from './server-timing';
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { StaffTeam } from './config';
import { CONFIG } from './config';
import { errorResponse } from './response-utils';

export interface ClientPrincipalClaim {
  typ: string;
  val: string;
}

/** User information that Static Web Apps passes to the API after a login. */
export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
  claims?: ClientPrincipalClaim[];
}

const TENANT_CLAIM_TYPES = ['tid', 'http://schemas.microsoft.com/identity/claims/tenantid'];

const UNAUTHENTICATED = errorResponse(
  401,
  'UNAUTHENTICATED',
  'Bitte melde dich mit deinem Stammes-Account an.'
);

const FORBIDDEN = errorResponse(
  403,
  'FORBIDDEN',
  'Dieser Bereich ist nur für Accounts des Stammes Phoenix freigegeben.'
);

const PREVIEW_ONLY = errorResponse(
  403,
  'PREVIEW_ONLY',
  'Dieses Testkonto ist nur für die Vorschau-Umgebungen von Pull Requests freigegeben.'
);

const NOT_IN_TEAM = errorResponse(
  403,
  'NOT_IN_TEAM',
  'Der Leitendenbereich ist nur für das Team „Leitende“ in Microsoft Teams freigegeben. Bist du gerade erst ins Team gekommen, melde dich ab und wieder an.'
);

/** PR previews have a database of their own on the preview server (`deployment.ts`). */
export function isPreviewDeployment(): boolean {
  return CONFIG.database.server === CONFIG.database.previewServer;
}

export function isPreviewOnlyLogin(login: string): boolean {
  const lower = login.toLowerCase();
  return CONFIG.staff.previewOnlyLogins.some((entry) => entry.toLowerCase() === lower);
}

/**
 * Whether the user belongs to the team. `GetRoles` turns the team into a role of Static Web Apps
 * at login, so a change of the team takes effect with the next login.
 */
export function hasTeam(principal: ClientPrincipal, team: StaffTeam): boolean {
  return principal.userRoles.includes(CONFIG.staff.teams[team].role);
}

function isClientPrincipal(value: unknown): value is ClientPrincipal {
  if (value === null || typeof value !== 'object') return false;
  const principal = value as Record<string, unknown>;
  return (
    typeof principal.identityProvider === 'string' &&
    typeof principal.userId === 'string' &&
    typeof principal.userDetails === 'string' &&
    Array.isArray(principal.userRoles)
  );
}

/** Decodes the `x-ms-client-principal` header set by Static Web Apps, if present. */
export function getClientPrincipal(request: HttpRequest): ClientPrincipal | undefined {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return undefined;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    return isClientPrincipal(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/** Returns the value of the first claim with one of the given types. */
export function getClaim(
  principal: Pick<ClientPrincipal, 'claims'>,
  types: string[]
): string | undefined {
  return principal.claims?.find((claim) => types.includes(claim.typ))?.val;
}

/**
 * Ensures the request comes from a logged-in member of our Entra ID tenant in the team „Leitende“.
 *
 * The routes in staticwebapp.config.json already restrict `/api/intern/*` to the team's role; this
 * check is a second line of defence in case a route rule is missing or misconfigured.
 *
 * The tenant itself is enforced by the login: the `openIdIssuer` of the Entra ID provider only
 * accepts accounts of our tenant. Static Web Apps does not forward the token claims to managed
 * functions, so the tenant claim can only be compared when it is present (e.g. with the SWA CLI).
 *
 * Test accounts in `CONFIG.staff.previewOnlyLogins` are refused outside PR previews, so they
 * never see production data.
 */
export function requireStaff(request: HttpRequest): ClientPrincipal | HttpResponseInit {
  const start = performance.now();
  try {
    const principal = getClientPrincipal(request);
    if (
      !principal ||
      principal.identityProvider !== 'aad' ||
      !principal.userRoles.includes('authenticated')
    ) {
      return UNAUTHENTICATED;
    }

    const tenantId = getClaim(principal, TENANT_CLAIM_TYPES);
    if (tenantId && tenantId !== CONFIG.azure.tenantId) {
      return FORBIDDEN;
    }

    if (isPreviewOnlyLogin(principal.userDetails) && !isPreviewDeployment()) {
      return PREVIEW_ONLY;
    }

    if (!hasTeam(principal, 'leitende')) {
      return NOT_IN_TEAM;
    }

    return principal;
  } finally {
    addTiming('auth', performance.now() - start);
  }
}

export function isStaffError(value: ClientPrincipal | HttpResponseInit): value is HttpResponseInit {
  return !('userId' in value);
}

const FIRST_NAME_CLAIMS = [
  'given_name',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
];
const FULL_NAME_CLAIMS = ['name'];

/**
 * First name of the logged-in person, e.g. for signing mails. Uses the name claims if Static
 * Web Apps passes them on, otherwise the part of the login before the `@`.
 */
export function getPrincipalFirstName(principal: ClientPrincipal): string {
  const givenName = getClaim(principal, FIRST_NAME_CLAIMS)?.trim();
  if (givenName) return givenName;
  const fullName = getClaim(principal, FULL_NAME_CLAIMS)?.trim();
  if (fullName) return fullName.split(/\s+/)[0];

  const first = principal.userDetails.split('@')[0].split(/[._-]/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : principal.userDetails;
}
