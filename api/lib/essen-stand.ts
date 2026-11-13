import type { Selectable } from 'kysely';
import type { Db } from './db';
import type { EssenPlanungTable } from './db-schema-essen-planung';
import { getDb, toVersion } from './db';
import type { Zugang } from './essen-zugang';
import { LINK_UNGUELTIG } from './essen-zugang';

/**
 * What a poll needs to know about a Planung, read in one query: the row of the Planung with its
 * change counter, the maintenance switch and retention of the Steuerung and the counter of the
 * central lists.
 */
export interface PlanungStand {
  planung: Selectable<EssenPlanungTable>;
  seq: number;
  aufbewahrungMonate: number;
  wartung: boolean;
  /** The counter of the central lists; the pages reload their lists when it changes. */
  katalogStand: string;
  /**
   * Read before anything else of the view: a change committed later has a higher counter, so the
   * next poll loads the view again instead of keeping a mix of old and new rows.
   */
  stand: string;
}

export async function ladeStand(zugang: Zugang, db: Db = getDb()): Promise<PlanungStand> {
  const row = await db
    .selectFrom('essen.planung as p')
    .crossJoin('essen.einstellungen as e')
    .crossJoin('essen.katalog_stand as k')
    .selectAll('p')
    .select([
      'e.version as einstellungen_version',
      'e.aufbewahrung_monate',
      'e.wartung',
      'k.seq as katalog_seq',
    ])
    .where('p.id', '=', zugang.planungId)
    .where('e.id', '=', 1)
    .where('k.id', '=', 1)
    .executeTakeFirst();
  if (!row) throw LINK_UNGUELTIG();
  const { einstellungen_version, aufbewahrung_monate, wartung, katalog_seq, ...planung } = row;
  const seq = Number(planung.aenderung_seq);
  return {
    planung,
    seq,
    aufbewahrungMonate: aufbewahrung_monate,
    wartung,
    katalogStand: katalog_seq,
    stand: `${seq}.${toVersion(einstellungen_version).replace(/\W/g, '')}.${katalog_seq}`,
  };
}
