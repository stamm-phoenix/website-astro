/**
 * Validation of the Einteilung of the Nikolausdienst before saving. The error is a
 * `ValidationError` with the first broken rule at `assignments`.
 */
import { z } from 'zod';
import { KITCHEN, TEAM_ROLES } from '../nikolaus-einteilung';
import type { HelperRole, TeamRole } from '../nikolaus-einteilung';
import { lenientObject, parseWith } from './zod';

export interface EinteilungSaveInput {
  version: string;
  assignments: { personId: string; date: string; team: string; role: HelperRole; fixed: boolean }[];
}

const MAX_ASSIGNMENTS = 1000;
const INVALID = 'Die Einteilung ist ungültig.';

/** What the browser sent per assignment; the rules follow once the days and helpers are known. */
const assignmentSchema = lenientObject({
  personId: z.string().catch(''),
  date: z.string().catch(''),
  team: z.string().catch(''),
  role: z.unknown().optional(),
  fixed: z
    .unknown()
    .optional()
    .transform((value) => value === true),
});

/**
 * @param teamsByDate Team names per configured day.
 * @param personIds IDs of the existing helpers.
 */
function einteilungSaveSchema(teamsByDate: Map<string, string[]>, personIds: Set<string>) {
  return lenientObject({
    version: z.string().catch(''),
    assignments: z
      .array(assignmentSchema, { error: INVALID })
      .max(MAX_ASSIGNMENTS, { error: INVALID })
      .superRefine((assignments, ctx) => {
        const personDays = new Set<string>();
        const posts = new Set<string>();
        const report = (message: string): void => {
          ctx.addIssue({ code: 'custom', message });
        };
        for (const { personId, date, team, role } of assignments) {
          const teams = teamsByDate.get(date);
          if (!personIds.has(personId)) {
            return report('Die Einteilung enthält gelöschte Personen. Bitte neu laden.');
          }
          if (!teams) return report('Die Einteilung enthält einen unbekannten Tag.');
          const isKitchen = team === KITCHEN && role === KITCHEN;
          if (!isKitchen && (!teams.includes(team) || !TEAM_ROLES.includes(role as TeamRole))) {
            return report('Die Einteilung enthält einen unbekannten Posten.');
          }
          const personDay = `${personId}|${date}`;
          if (personDays.has(personDay)) {
            return report('Eine Person ist an einem Tag mehrfach eingeteilt.');
          }
          personDays.add(personDay);
          const post = `${date}|${team}|${String(role)}`;
          if (!isKitchen && posts.has(post)) return report('Ein Posten ist mehrfach besetzt.');
          posts.add(post);
        }
      }),
  }).transform(({ version, assignments }): EinteilungSaveInput => ({
    version,
    assignments: assignments.map((assignment) => ({
      ...assignment,
      role: assignment.role as HelperRole,
    })),
  }));
}

/**
 * Checks the Einteilung before saving.
 * @param teamsByDate Team names per configured day.
 * @param personIds IDs of the existing helpers.
 */
export function validateEinteilungSave(
  body: unknown,
  teamsByDate: Map<string, string[]>,
  personIds: Set<string>
): EinteilungSaveInput {
  return parseWith(einteilungSaveSchema(teamsByDate, personIds), body);
}
