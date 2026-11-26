import { z } from 'zod';
import { kiText } from './essen-ki-model';
import type { DoppelteZutaten, KiDoppelte } from './essen-zutat-zentral-model';

/**
 * Reading the AI's answer to „Doppelte finden (KI)“ (`essen-ki-doppelte.ts`). Without database or
 * network, so the mock API uses it too. Only groups of at least two known ingredients count; an
 * ingredient is in one group at most, and the one to keep is one of the group.
 */

const gruppeSchema = z.object({
  ids: z.array(z.unknown()),
  behalten: z.unknown(),
  grund: kiText(300).catch(''),
});

const antwortSchema = z.object({ gruppen: z.array(z.unknown()) });

/** At most this many groups are shown; the user merges them one by one. */
export const MAX_DOPPELTE = 60;

export function leseKiDoppelte(raw: unknown, bekannt: ReadonlySet<number>): KiDoppelte {
  const antwort = antwortSchema.safeParse(raw);
  if (!antwort.success) throw new Error('Invalid answer of the duplicates');
  const vergeben = new Set<number>();
  const gruppen: DoppelteZutaten[] = [];
  for (const value of antwort.data.gruppen) {
    const gruppe = gruppeSchema.safeParse(value);
    if (!gruppe.success) continue;
    const ids = [
      ...new Set(
        gruppe.data.ids.filter(
          (id): id is number => typeof id === 'number' && bekannt.has(id) && !vergeben.has(id)
        )
      ),
    ];
    if (ids.length < 2) continue;
    const behalten =
      typeof gruppe.data.behalten === 'number' && ids.includes(gruppe.data.behalten)
        ? gruppe.data.behalten
        : ids[0];
    for (const id of ids) vergeben.add(id);
    gruppen.push({ ids, behalten, grund: gruppe.data.grund });
    if (gruppen.length >= MAX_DOPPELTE) break;
  }
  return { gruppen };
}
