import { loginUrl } from './api';

/** Pages and files that need the login of the Leitendenbereich. */
const PROTECTED = /^\/(leitendenbereich|api\/intern)(\/|$)/;

/** The parts of a link's address that decide where it leads. */
export interface LinkAddress {
  origin: string;
  pathname: string;
  search: string;
  hash: string;
}

/**
 * In the iPhone app a link opening a new window goes to Safari, which has its own login. A
 * protected page of this site is opened through the login there, which comes back to it with
 * its query and fragment. Null for any other link, which opens as it is.
 */
export function loginForNewWindow(link: LinkAddress, origin: string): string | null {
  if (link.origin !== origin || !PROTECTED.test(link.pathname)) return null;
  return loginUrl(`${link.pathname}${link.search}${link.hash}`);
}
