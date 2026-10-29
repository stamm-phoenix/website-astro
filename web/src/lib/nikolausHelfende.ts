import { HELPER_ROLES } from './nikolausEinteilung';
import type { HelperRole } from './nikolausEinteilung';
import type { StaffNikolausHelfendeData } from './types';

export interface HelperCoverage {
  date: string;
  teams: number;
  counts: { role: HelperRole; count: number; names: string[] }[];
}

/** Volunteers per day and post, to compare with what is needed (one per team). */
export function helperCoverage(data: StaffNikolausHelfendeData): HelperCoverage[] {
  return data.days.map((day) => ({
    date: day.date,
    teams: day.teams.length,
    counts: HELPER_ROLES.map((role) => {
      const names = data.persons
        .filter((p) => (p.availability[day.date] ?? []).includes(role))
        .map((p) => p.name);
      return { role, count: names.length, names };
    }),
  }));
}
