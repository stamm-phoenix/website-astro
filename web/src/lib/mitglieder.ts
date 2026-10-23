import { formatDate, formatName } from './campflowFields';
import { mapGroupToStufe } from './campflowGroups';
import type { CampflowPerson } from './types';

/** Whether someone is a member today, will join later or has left. */
export type MitgliedStatus = 'aktiv' | 'kuenftig' | 'ausgetreten';

/** Tab of the member list: everyone, a group (`gruppe:<name>`), no group or the former members. */
export type MitgliederAnsicht = 'alle' | 'ohne-gruppe' | 'ausgetreten' | `gruppe:${string}`;

/** The order of the Stufen; their groups come first, the others follow by name. */
const STUFEN = ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover'];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Status on `today` (`YYYY-MM-DD`) from the join and leave date of the member list. */
export function mitgliedStatus(person: CampflowPerson, today: string): MitgliedStatus {
  const leave = text(person.leave_date);
  if (leave && leave <= today) return 'ausgetreten';
  const join = text(person.join_date);
  return join && join > today ? 'kuenftig' : 'aktiv';
}

/** One line on the membership, e.g. „Mitglied seit 01.09.2019“ or „Ausgetreten am …“. */
export function mitgliedSeit(person: CampflowPerson, today: string): string {
  const status = mitgliedStatus(person, today);
  const join = formatDate(text(person.join_date));
  const leave = formatDate(text(person.leave_date));
  if (status === 'ausgetreten') return leave ? `Ausgetreten am ${leave}` : 'Ausgetreten';
  if (status === 'kuenftig') return `Tritt am ${join} ein`;
  const parts = [join ? `Mitglied seit ${join}` : 'Mitglied'];
  if (leave) parts.push(`tritt am ${leave} aus`);
  return parts.join(', ');
}

/** The CampFlow groups of a person, trimmed and without duplicates. */
export function personGroups(person: CampflowPerson): string[] {
  const groups = Array.isArray(person.group_names) ? person.group_names : [];
  return [...new Set(groups.map(text).filter(Boolean))];
}

/** A group name without emoji and symbols, for sorting („🟠 Wölfling“ → „Wölfling“). */
function plainGroupName(group: string): string {
  return group.replace(/[^\p{L}\p{N}\s*]/gu, '').trim();
}

function groupRank(group: string): number {
  const stufe = mapGroupToStufe(group);
  return stufe ? STUFEN.indexOf(stufe) : STUFEN.length;
}

/** All groups of the members: the Stufen in their order, then the other groups by name. */
export function gruppen(persons: CampflowPerson[]): string[] {
  const all = new Set(persons.flatMap(personGroups));
  return [...all].sort(
    (a, b) =>
      groupRank(a) - groupRank(b) || plainGroupName(a).localeCompare(plainGroupName(b), 'de')
  );
}

/** Whether a person belongs in the tab; groups and „Alle“ show only current members. */
export function inAnsicht(
  person: CampflowPerson,
  ansicht: MitgliederAnsicht,
  today: string
): boolean {
  const ausgetreten = mitgliedStatus(person, today) === 'ausgetreten';
  if (ansicht === 'ausgetreten') return ausgetreten;
  if (ausgetreten) return false;
  if (ansicht === 'alle') return true;
  const groups = personGroups(person);
  if (ansicht === 'ohne-gruppe') return groups.length === 0;
  return groups.includes(ansicht.slice('gruppe:'.length));
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Whether every word of the search appears in the name, member number or an e-mail address. */
export function matchesSearch(person: CampflowPerson, search: string): boolean {
  const words = normalize(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize(
    [
      formatName(person),
      text(person.membership_number),
      text(person.primary_email),
      ...(Array.isArray(person.cc_emails) ? person.cc_emails.map(text) : []),
    ].join(' ')
  );
  return words.every((word) => haystack.includes(word));
}

function sortName(person: CampflowPerson): string {
  const name = person.name && typeof person.name === 'object' ? person.name : {};
  const { first_name: first, last_name: last } = name as Record<string, unknown>;
  return `${text(last)} ${text(first)}`;
}

/** Persons by last name, then first name. */
export function sortMitglieder(persons: CampflowPerson[]): CampflowPerson[] {
  return [...persons].sort((a, b) => sortName(a).localeCompare(sortName(b), 'de'));
}
