import { getAllBookings } from './nikolaus-bookings';
import { toLocation } from './nikolaus-api';
import { NIKOLAUS_SLOT_MINUTES, getNikolausTeams } from './nikolaus-config';
import { confirmedOfDay, getTeamMembers } from './nikolaus-day';
import {
  evaluateDispo,
  minutesToTime,
  solveDispo,
  timeToMinutes,
  visitMinutes,
} from './nikolaus-dispo';
import type { DispoProblem } from './nikolaus-dispo';
import { getDispoRows, getDispoVersion, saveDispo } from './nikolaus-dispo-list';
import { conflictingTags, solveEinteilung } from './nikolaus-einteilung';
import {
  getEinteilungRows,
  getEinteilungVersion,
  saveEinteilung,
} from './nikolaus-einteilung-list';
import { getHelpers } from './nikolaus-helfende-list';
import { getNikolausSettings } from './nikolaus-settings';
import { getTravelMatrix } from './travel-times';

/**
 * Saves an Einteilung and a Dispo per day, as the Leitendenbereich would suggest them, so the
 * Fahrt view and the plans have something to show. Plans that exist are kept. Uses the shared
 * connection (`useDatabase`); driving times are always estimated for the invented preview addresses.
 */
export async function seedPreviewPlans(): Promise<void> {
  const settings = await getNikolausSettings();
  const dates = settings.days.map((day) => day.date).sort();
  const teams = (date: string): string[] =>
    getNikolausTeams(date, settings).map((team) => team.name);

  if ((await getEinteilungRows()).length === 0) {
    const helpers = await getHelpers();
    const { assignments } = solveEinteilung({
      persons: helpers.map((helper) => ({
        id: helper.id,
        name: helper.name,
        availability: helper.availability,
        positiveTags: helper.positiveTags,
        negativeTags: helper.negativeTags,
      })),
      days: dates.map((date) => ({ date, teams: teams(date), familyTags: null })),
    });
    if (assignments.length > 0) await saveEinteilung(assignments, getEinteilungVersion([]));
  }

  const bookings = await getAllBookings();
  for (const date of dates) {
    const stops = confirmedOfDay(bookings, date);
    if (stops.length === 0 || (await getDispoRows(date)).length > 0) continue;
    // As in the Dispo: no family goes to a team with a helper who has a matching negative tag
    const members = await getTeamMembers(date);
    const forbidden: Record<string, string[]> = {};
    for (const booking of stops) {
      const blocked = teams(date).filter((team) =>
        (members[team] ?? []).some(
          (member) => conflictingTags(member, [booking.internalTags], member.role).length > 0
        )
      );
      if (blocked.length > 0) forbidden[booking.id] = blocked;
    }
    const travel = await getTravelMatrix(
      [settings.area.base, ...stops.map((booking) => toLocation(booking))],
      { estimateOnly: true }
    );
    const problem: DispoProblem = {
      forbidden,
      stops: stops.map((booking) => {
        const slotStart = timeToMinutes(booking.slotKey.split('T')[1] ?? '00:00');
        return {
          id: booking.id,
          slotStart,
          slotEnd: slotStart + NIKOLAUS_SLOT_MINUTES,
          duration: visitMinutes(booking.childrenCount),
        };
      }),
      teams: teams(date),
      travel: travel.minutes,
    };
    const slotKeys = new Map(stops.map((booking) => [booking.id, booking.slotKey]));
    const plan = evaluateDispo(problem, solveDispo(problem));
    const entries = plan.routes.flatMap((route) =>
      route.stops.map((stop, index) => ({
        bookingId: stop.id,
        team: route.team,
        order: index + 1,
        slotKey: slotKeys.get(stop.id) ?? '',
        plannedArrival: minutesToTime(stop.start),
        fixed: false,
      }))
    );
    await saveDispo(date, entries, getDispoVersion([]));
  }
}
