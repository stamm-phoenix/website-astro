import type { ClientPrincipal } from './types';

interface AuthStoreState {
  principal: ClientPrincipal | null;
  loading: boolean;
  error: boolean;
}

export const authStore = $state<AuthStoreState>({
  principal: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

/** Loads the logged-in user from the Static Web Apps auth endpoint. */
export function fetchPrincipal(): Promise<void> {
  if (authStore.principal) return Promise.resolve();
  if (fetchPromise) return fetchPromise;

  authStore.loading = true;
  authStore.error = false;

  fetchPromise = (async () => {
    try {
      const response = await fetch('/.auth/me', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Auth error: ${response.status}`);
      const body = (await response.json()) as { clientPrincipal: ClientPrincipal | null };
      authStore.principal = body.clientPrincipal;
    } catch {
      authStore.error = true;
    } finally {
      fetchPromise = null;
      authStore.loading = false;
    }
  })();

  return fetchPromise;
}

const NAME_CLAIMS = [
  'given_name',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
];
const FULL_NAME_CLAIMS = ['name'];

/** First name of the user, falling back to the part of the login before the `@`. */
export function getFirstName(principal: ClientPrincipal): string {
  const claim = (types: string[]): string | undefined =>
    principal.claims?.find((c) => types.includes(c.typ))?.val?.trim() || undefined;

  const givenName = claim(NAME_CLAIMS);
  if (givenName) return givenName;

  const fullName = claim(FULL_NAME_CLAIMS);
  if (fullName) return fullName.split(/\s+/)[0];

  const login = principal.userDetails.split('@')[0];
  const first = login.split(/[._-]/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : principal.userDetails;
}
