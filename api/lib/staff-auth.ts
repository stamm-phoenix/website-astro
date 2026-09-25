import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { EnvironmentVariable, getEnvironment } from './environment';
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
export function getClaim(principal: ClientPrincipal, types: string[]): string | undefined {
  return principal.claims?.find((claim) => types.includes(claim.typ))?.val;
}

/**
 * Ensures the request comes from a logged-in member of our Entra ID tenant.
 *
 * The routes in staticwebapp.config.json already restrict `/api/intern/*`; this check is a
 * second line of defence in case a route rule is missing or misconfigured. Requests without
 * a tenant claim are rejected.
 */
export function requireStaff(request: HttpRequest): ClientPrincipal | HttpResponseInit {
  const principal = getClientPrincipal(request);
  if (
    !principal ||
    principal.identityProvider !== 'aad' ||
    !principal.userRoles.includes('authenticated')
  ) {
    return UNAUTHENTICATED;
  }

  const tenantId = getClaim(principal, TENANT_CLAIM_TYPES);
  if (!tenantId || tenantId !== getEnvironment(EnvironmentVariable.AZURE_TENANT_ID)) {
    return FORBIDDEN;
  }

  return principal;
}

export function isStaffError(value: ClientPrincipal | HttpResponseInit): value is HttpResponseInit {
  return !('userId' in value);
}
