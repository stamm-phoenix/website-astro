import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import type { Database } from './db-schema';
import type { AbstimmungEingabe } from './abstimmung-model';

/**
 * Writes the options of the form in their order: the known ones (`id`, checked by the caller)
 * with one `UPDATE`, the new ones with one multi-row `INSERT`. The table holds at most
 * `MAX_ABSTIMMUNG_OPTIONEN` options per Abstimmung, far below the 2100 parameters of a statement.
 */
export async function writeOptionen(
  trx: Transaction<Database>,
  abstimmungId: number,
  input: AbstimmungEingabe
): Promise<void> {
  const bekannt: { id: number; text: string; position: number }[] = [];
  const neu: { abstimmung_id: number; position: number; text: string }[] = [];
  for (const [position, option] of input.optionen.entries()) {
    if (option.id) bekannt.push({ id: option.id, text: option.text, position });
    else neu.push({ abstimmung_id: abstimmungId, position, text: option.text });
  }
  if (bekannt.length) {
    const werte = sql.join(bekannt.map((o) => sql`(${o.id}, ${o.text}, ${o.position})`));
    await sql`
      UPDATE o SET o.text = v.text, o.position = v.position
      FROM abstimmung.optionen AS o
      JOIN (VALUES ${werte}) AS v(id, text, position) ON v.id = o.id
      WHERE o.abstimmung_id = ${abstimmungId}
    `.execute(trx);
  }
  if (neu.length) await trx.insertInto('abstimmung.optionen').values(neu).execute();
}
