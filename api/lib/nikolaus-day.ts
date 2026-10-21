import type { HttpRequest } from '@azure/functions';
import type { NikolausBooking } from './nikolaus-bookings';
import type { NikolausConfig } from './nikolaus-config';
import { getNikolausTeams } from './nikolaus-config';
import { getDb, parseStringList } from './db';
import type { HelperRole } from './nikolaus-einteilung';
import { HELPER_ROLES, KITCHEN } from './nikolaus-einteilung';

/** A helper of a team on one day, from the saved Einteilung. */
export interface TeamMember {
  personId: string;
  name: string;
  role: string;
  negativeTags: string[];
  positiveTags: string[];
}

/** The `date` query parameter, if it is a date; before the settings are known. */
export function readDateParam(request: HttpRequest): string | null {
  const date = request.query.get('date') ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** The `date` query parameter, if it is a configured Nikolaus day. */
export function readDate(request: HttpRequest, config: NikolausConfig): string | null {
  const date = readDateParam(request);
  return date && getNikolausTeams(date, config).length > 0 ? date : null;
}

/** Confirmed bookings of a day, in chronological order. */
export function confirmedOfDay(bookings: NikolausBooking[], date: string): NikolausBooking[] {
  return bookings
    .filter((b) => b.status === 'Bestaetigt' && b.slotKey.startsWith(`${date}T`))
    .sort((a, b) => a.slotKey.localeCompare(b.slotKey) || Number(a.id) - Number(b.id));
}

/**
 * Helpers of the day per team from the saved Einteilung. Optional for the Dispo and the
 * Fahrt view: if the lists are not set up or cannot be read, both work without them.
 */
export async function getTeamMembers(date: string): Promise<Record<string, TeamMember[]>> {
  try {
    const rows = await getDb()
      .selectFrom('nikolaus.assignment as a')
      .innerJoin('nikolaus.helper as h', 'h.id', 'a.helper_id')
      .select(['a.helper_id', 'a.team', 'a.role', 'h.name', 'h.negative_tags', 'h.positive_tags'])
      .where('a.date', '=', date)
      .where('a.team', '<>', KITCHEN)
      .orderBy('a.helper_id')
      .execute();
    const members: Record<string, TeamMember[]> = {};
    for (const row of rows) {
      (members[row.team] ??= []).push({
        personId: String(row.helper_id),
        name: row.name.trim(),
        role: row.role,
        negativeTags: parseStringList(row.negative_tags),
        positiveTags: parseStringList(row.positive_tags),
      });
    }
    // Always in the order of the posts (Nikolaus, Krampus, …), not in the order of the list
    const rank = (role: string): number => HELPER_ROLES.indexOf(role as HelperRole);
    for (const list of Object.values(members)) list.sort((a, b) => rank(a.role) - rank(b.role));
    return members;
  } catch (error: unknown) {
    console.warn('Einteilung could not be loaded', error);
    return {};
  }
}
