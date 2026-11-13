import { sql } from 'kysely';
import type { Db } from './db';

interface MahlzeitPosition {
  id: number;
  position: number;
}

/**
 * The positions the meals of one day get so they count 1, 2, 3, … in their current order
 * (position, then id), with `verschiebe` moved to its 1-based position (clamped to the day).
 * Returns only the meals whose position changes.
 */
export function neueMahlzeitPositionen(
  mahlzeiten: MahlzeitPosition[],
  verschiebe?: MahlzeitPosition
): MahlzeitPosition[] {
  const reihenfolge = [...mahlzeiten].sort((a, b) => a.position - b.position || a.id - b.id);
  const ids = reihenfolge.map((mahlzeit) => mahlzeit.id);
  if (verschiebe) {
    const ohne = ids.filter((id) => id !== verschiebe.id);
    ohne.splice(Math.min(Math.max(verschiebe.position - 1, 0), ohne.length), 0, verschiebe.id);
    ids.splice(0, ids.length, ...ohne);
  }
  const aktuell = new Map(mahlzeiten.map((mahlzeit) => [mahlzeit.id, mahlzeit.position]));
  return ids
    .map((id, index) => ({ id, position: index + 1 }))
    .filter((neu) => aktuell.get(neu.id) !== neu.position);
}

/**
 * Renumbers the meals of a day with one read and one statement; with `verschiebe` that meal
 * moves to its position first. Called inside the lock of the Planung.
 */
export async function nummeriereMahlzeiten(
  trx: Db,
  tagId: number,
  verschiebe?: MahlzeitPosition
): Promise<void> {
  const mahlzeiten = await trx
    .selectFrom('essen.mahlzeit')
    .select(['id', 'position'])
    .where('tag_id', '=', tagId)
    .execute();
  const geaendert = neueMahlzeitPositionen(mahlzeiten, verschiebe);
  if (geaendert.length === 0) return;
  await sql`
    UPDATE m SET position = v.position
    FROM essen.mahlzeit m
    JOIN (VALUES ${sql.join(geaendert.map((neu) => sql`(${neu.id}, ${neu.position})`))}) AS v(id, position)
      ON v.id = m.id`.execute(trx);
}
