/**
 * Stufen-Abgleich for the Nikolaus Einteilung: suggests the Stufe of a family's children as a
 * booking tag (from the CampFlow member list) and the Stufen a helper leads as negative tags
 * (from the Leitende list). Suggestions are only applied when accepted in the Leitendenbereich.
 */
import type { CampflowPerson } from './campflow';
import { campflowGetAll } from './campflow';
import type { Leitende } from './leitende-list';
import type { NikolausBooking } from './nikolaus-bookings';
import type { Helper } from './nikolaus-helfende-list';
import { normalizeTag } from './nikolaus-einteilung';
import { STUFEN } from './pflege-validation';
import { mapGroupToStufe } from './campflow-groups';

export { mapGroupToStufe };

/** A member of the CampFlow member list, reduced to what the matching needs. */
export interface StufenMember {
  firstName: string;
  lastName: string;
  street: string;
  postalCode: string;
  stufen: string[];
}

export type StufenMatch = 'name-address' | 'address' | 'leitung';

export interface StufenSuggestion {
  id: string;
  kind: 'booking' | 'helper';
  targetId: string;
  targetName: string;
  stufe: string;
  match: StufenMatch;
  /** Why the suggestion was made, e.g. the names of the children. */
  evidence: string[];
}

/** Street with house number, reduced to letters and digits („Hauptstr. 12 a“ → „hauptstrasse12a“). */
export function normalizeStreet(street: string): string {
  return street
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .replace(/str\.?(?=[\s\d,]|$)/g, 'strasse')
    .replace(/[^\p{L}\d]/gu, '');
}

/** Name for comparisons: lower case, words separated by single spaces (hyphens count as spaces). */
export function normalizeName(name: string): string {
  return name
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .replace(/[\s-]+/g, ' ')
    .trim();
}

/** A text field of a CampFlow person; numbers (e.g. a postcode) are converted. */
function text(value: unknown): string {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Reduces a CampFlow person; `undefined` for former members and persons without a Stufe. */
export function toStufenMember(person: CampflowPerson, today: string): StufenMember | undefined {
  const leaveDate = text(person.leave_date);
  if (leaveDate && leaveDate <= today) return undefined;
  const groups = Array.isArray(person.group_names) ? person.group_names : [];
  const stufen = [
    ...new Set(groups.map((g) => (typeof g === 'string' ? mapGroupToStufe(g) : undefined))),
  ].filter((s): s is string => s !== undefined);
  if (stufen.length === 0) return undefined;
  const name = record(person.name);
  const address = record(person.address);
  return {
    firstName: text(name.first_name),
    lastName: text(name.last_name),
    street: text(address.street),
    postalCode: text(address.postcode),
    stufen,
  };
}

/** Current members of the CampFlow member list that belong to a Stufe. */
export async function getStufenMembers(now: Date = new Date()): Promise<StufenMember[]> {
  const persons = await campflowGetAll<CampflowPerson>('/lists/member/persons');
  const today = now.toISOString().slice(0, 10);
  return persons
    .map((person) => toStufenMember(person, today))
    .filter((m): m is StufenMember => m !== undefined);
}

export function hasTag(tags: string[], tag: string): boolean {
  const key = normalizeTag(tag);
  return tags.some((t) => normalizeTag(t) === key);
}

function familySuggestions(booking: NikolausBooking, members: StufenMember[]): StufenSuggestion[] {
  const street = normalizeStreet(booking.street);
  const postalCode = booking.postalCode.trim();
  if (!street || !postalCode) return [];
  const familyName = ` ${normalizeName(booking.familyName)} `;

  const byStufe = new Map<string, { match: StufenMatch; evidence: string[] }>();
  for (const member of members) {
    if (member.postalCode !== postalCode || normalizeStreet(member.street) !== street) continue;
    const lastName = normalizeName(member.lastName);
    const sameName = lastName !== '' && familyName.includes(` ${lastName} `);
    for (const stufe of member.stufen) {
      const entry = byStufe.get(stufe) ?? { match: 'address' as StufenMatch, evidence: [] };
      if (sameName) entry.match = 'name-address';
      entry.evidence.push(`${member.firstName} ${member.lastName}`.trim());
      byStufe.set(stufe, entry);
    }
  }

  return [...byStufe]
    .filter(([stufe]) => !hasTag(booking.internalTags, stufe))
    .filter(([stufe]) => !hasTag(booking.rejectedStufen, stufe))
    .map(([stufe, { match, evidence }]) => ({
      id: `booking-${booking.id}-${stufe}`,
      kind: 'booking',
      targetId: booking.id,
      targetName: booking.familyName,
      stufe,
      match,
      evidence,
    }));
}

function helperSuggestions(helper: Helper, leitende: Leitende[]): StufenSuggestion[] {
  const name = normalizeName(helper.name);
  if (!name) return [];
  const stufen = new Set(
    leitende
      .filter((l) => normalizeName(l.name) === name)
      .flatMap((l) => l.teams.filter((team) => STUFEN.includes(team)))
  );
  return [...stufen]
    .filter((stufe) => !hasTag(helper.negativeTags, stufe))
    .filter((stufe) => !hasTag(helper.positiveTags, stufe))
    .filter((stufe) => !hasTag(helper.rejectedStufen, stufe))
    .map((stufe) => ({
      id: `helper-${helper.id}-${stufe}`,
      kind: 'helper',
      targetId: helper.id,
      targetName: helper.name,
      stufe,
      match: 'leitung',
      evidence: [`leitet die ${stufe}`],
    }));
}

/**
 * All open suggestions: Stufen of children living at a family's address, and the Stufen a
 * helper leads. Tags that are already set or were rejected before are left out.
 */
export function buildSuggestions(input: {
  bookings: NikolausBooking[];
  helpers: Helper[];
  members: StufenMember[];
  leitende: Leitende[];
}): StufenSuggestion[] {
  const stufeOrder = (s: StufenSuggestion): number => STUFEN.indexOf(s.stufe);
  return [
    ...input.bookings
      .flatMap((booking) => familySuggestions(booking, input.members))
      .sort(
        (a, b) => a.targetName.localeCompare(b.targetName, 'de') || stufeOrder(a) - stufeOrder(b)
      ),
    ...input.helpers.flatMap((helper) => helperSuggestions(helper, input.leitende)),
  ];
}

/** Adds a tag unless it is already present. */
export function withTag(tags: string[], tag: string): string[] {
  return hasTag(tags, tag) ? tags : [...tags, tag];
}
