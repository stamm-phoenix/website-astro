import { randomBytes } from 'node:crypto';

/** Someone who is not the organizer tried to manage an Abstimmung. */
export class AbstimmungForbiddenError extends Error {
  constructor() {
    super('Nur die Person, die die Abstimmung angelegt hat, kann sie ändern.');
    this.name = 'AbstimmungForbiddenError';
  }
}

/** The Abstimmung is closed; nobody can vote any more. */
export class AbstimmungClosedError extends Error {
  constructor() {
    super('Diese Abstimmung ist beendet. Du kannst nicht mehr abstimmen.');
    this.name = 'AbstimmungClosedError';
  }
}

/** The logged-in person as the module recognizes them. */
export interface AbstimmungPerson {
  /** Login, lower case. */
  login: string;
  /** Display name for the results. */
  name: string;
  /**
   * Addresses an invitation to this person may have gone to: the login and the address of the
   * linked CampFlow person. An invitation to one of them is taken over when they vote here.
   */
  adressen: string[];
  /**
   * The address stored with an answer given here, so a later invitation to it finds the answer:
   * the linked CampFlow address, or the login when that address is shared, e.g. by a family.
   */
  adresse?: string;
}

/** What recognizes the logged-in person in the rows of an Abstimmung. */
export type AbstimmungIdentitaet = Pick<AbstimmungPerson, 'login' | 'adressen'>;

/** A secret for a link: 32 random bytes, base64url without padding (43 characters). */
export function newAbstimmungToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Whether a value can be a token at all; anything else is not looked up. */
export function isAbstimmungToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Whether a value can be the key of an answer try: a UUID from the page. */
export function isAbstimmungVersuch(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}

/** Link for everyone; whoever opens it enters a name. */
export function abstimmungLink(siteUrl: string, linkToken: string): string {
  return `${siteUrl}/abstimmung#link=${linkToken}`;
}

/** Personal link of one person, to answer and to change the answer. */
export function abstimmungPersonalLink(siteUrl: string, token: string): string {
  return `${siteUrl}/abstimmung#t=${token}`;
}
