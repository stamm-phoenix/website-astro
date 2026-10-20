/**
 * Types of the module „Personen“ (`docs/personen.md`), shared with the frontend, so keep it free
 * of Node-specific imports.
 */
import type { PersonGruppe } from './protokoll-editor-model';

/** Format of an ID in the CampFlow member list, e.g. `per_AbC123`. */
export const CAMPFLOW_PERSON_ID = /^per_[A-Za-z0-9]{1,60}$/;

/**
 * A person of the list kept in the Leitendenbereich. Leaders come from the Entra group; their
 * row (`gruppe: 'leitende'`) only links their account to CampFlow. Altleitende and others are
 * offered in the Protokoll-Editor (#301).
 */
export interface Person {
  id: number;
  name: string;
  /** Login in our tenant, if the person has one; empty otherwise. */
  login: string;
  gruppe: PersonGruppe;
  /** ID in the CampFlow member list (`per_…`), or empty. */
  campflowPersonId: string;
  /** Inactive people stay in old minutes but are no longer offered. */
  aktiv: boolean;
  etag: string;
  updatedAt: string;
  updatedBy: string;
}

export type PersonInput = Pick<Person, 'name' | 'login' | 'gruppe' | 'campflowPersonId' | 'aktiv'>;

/** An account of the Entra group of the leaders. */
export interface LeitendenKonto {
  login: string;
  name: string;
}

/** A person of the CampFlow member list, reduced to what the linking needs. */
export interface CampflowMitglied {
  id: string;
  firstName: string;
  lastName: string;
  groups: string[];
  /** Has a leave date that has passed. */
  ausgetreten: boolean;
}

/**
 * Everything the module shows. A source that fails is `null`; the list can still be edited.
 */
export interface PersonenUebersicht {
  personen: Person[];
  leitende: LeitendenKonto[] | null;
  campflow: CampflowMitglied[] | null;
}

/** The logged-in person with their linked CampFlow person (`GET /api/intern/ich`). */
export interface Ich {
  login: string;
  campflow: {
    id: string;
    /** Empty if CampFlow could not be read; the ID still identifies the person. */
    firstName: string;
    lastName: string;
    /** Primary address in CampFlow, lowercase, or empty. */
    email: string;
  } | null;
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');
}

/** Same full name, ignoring case and spaces; for suggestions only, never saved by itself. */
export function sameName(a: string, b: string): boolean {
  const left = normalizeName(a);
  return left !== '' && left === normalizeName(b);
}

/** The full name of a CampFlow person. */
export function mitgliedName(person: Pick<CampflowMitglied, 'firstName' | 'lastName'>): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

/**
 * Suggested CampFlow person per login: the only current member with the same name, if no row
 * links that person yet. Only a suggestion, so the module asks before it saves anything.
 */
export function campflowVorschlaege(
  konten: LeitendenKonto[],
  personen: Person[],
  mitglieder: CampflowMitglied[]
): Map<string, CampflowMitglied> {
  const linked = new Set(personen.map((p) => p.campflowPersonId).filter(Boolean));
  const linkedLogins = new Set(
    personen.filter((p) => p.campflowPersonId).map((p) => p.login.toLowerCase())
  );
  const result = new Map<string, CampflowMitglied>();
  for (const konto of konten) {
    if (linkedLogins.has(konto.login.toLowerCase())) continue;
    const matches = mitglieder.filter(
      (m) => !m.ausgetreten && sameName(mitgliedName(m), konto.name)
    );
    if (matches.length === 1 && !linked.has(matches[0].id)) result.set(konto.login, matches[0]);
  }
  // Two accounts with the same name: neither gets a suggestion
  const counts = new Map<string, number>();
  for (const m of result.values()) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  for (const [login, mitglied] of [...result]) {
    if (counts.get(mitglied.id)! > 1) result.delete(login);
  }
  return result;
}
