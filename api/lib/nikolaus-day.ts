import type { HttpRequest } from '@azure/functions';
import type { NikolausBooking } from './nikolaus-bookings';
import { getNikolausTeams } from './nikolaus-config';
import { getHelpers } from './nikolaus-helfende-list';
import { getEinteilungRows } from './nikolaus-einteilung-list';
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

/** The `date` query parameter, if it is a configured Nikolaus day. */
export function readDate(request: HttpRequest): string | null {
  const date = request.query.get('date') ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && getNikolausTeams(date).length > 0 ? date : null;
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
    const [helpers, rows] = await Promise.all([getHelpers(), getEinteilungRows()]);
    const byId = new Map(helpers.map((h) => [h.id, h]));
    const members: Record<string, TeamMember[]> = {};
    for (const row of rows) {
      const helper = byId.get(row.personId);
      if (row.date !== date || row.team === KITCHEN || !helper) continue;
      (members[row.team] ??= []).push({
        personId: helper.id,
        name: helper.name,
        role: row.role,
        negativeTags: helper.negativeTags,
        positiveTags: helper.positiveTags,
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
