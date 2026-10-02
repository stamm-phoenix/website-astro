const STORAGE_KEY = 'nikolaus-management-token';

/** Reads fragment links and migrates old mail links out of the query string. */
export function readNikolausManageToken(): string {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const legacy = url.searchParams.get('token');
  const explicit = fragment.has('token') || url.searchParams.has('token');
  let token = fragment.has('token') ? (fragment.get('token') ?? '') : (legacy ?? '');
  if (token.length > 200) token = '';

  if (legacy !== null) {
    url.searchParams.delete('token');
    if (!fragment.has('token') && token) url.hash = new URLSearchParams({ token }).toString();
    window.history.replaceState(window.history.state, '', url);
  }

  try {
    if (explicit) {
      if (token) window.sessionStorage.setItem(STORAGE_KEY, token);
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } else token = window.sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    // A mail link also works when the browser disallows session storage.
  }
  return token;
}
