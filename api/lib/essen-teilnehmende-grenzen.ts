import type { Db } from './db';
import { ValidationError } from './validation/errors';

/**
 * The limits of the stay of participants (`von_mahlzeit_id`, `bis_mahlzeit_id`) when the meals
 * change: deleted meals move them, reordering must not put an end before its start.
 */

/** The meals of a Planung in their order: days by date, meals by position. */
async function mahlzeitenReihe(trx: Db, planungId: number): Promise<number[]> {
  return (
    await trx
      .selectFrom('essen.mahlzeit as m')
      .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
      .select('m.id')
      .where('t.planung_id', '=', planungId)
      .orderBy('t.datum')
      .orderBy('m.position')
      .orderBy('m.id')
      .execute()
  ).map((row) => row.id);
}

/**
 * Before meals go: participants who start or end at one of them start at the next remaining
 * meal or end at the one before, so their stay keeps its length as far as possible.
 */
export async function verschiebeGrenzen(trx: Db, planungId: number, weg: number[]): Promise<void> {
  if (!weg.length) return;
  const betroffen = await trx
    .selectFrom('essen.teilnehmende')
    .select(['id', 'von_mahlzeit_id', 'bis_mahlzeit_id'])
    .where('planung_id', '=', planungId)
    .where((eb) => eb.or([eb('von_mahlzeit_id', 'in', weg), eb('bis_mahlzeit_id', 'in', weg)]))
    .execute();
  if (!betroffen.length) return;
  const reihe = await mahlzeitenReihe(trx, planungId);
  const bleibt = (id: number) => !weg.includes(id);
  for (const zeile of betroffen) {
    let von = zeile.von_mahlzeit_id;
    let bis = zeile.bis_mahlzeit_id;
    if (von !== null && weg.includes(von)) {
      // The next remaining meal; none left: the row keeps the gone one and eats nowhere
      von = reihe.slice(reihe.indexOf(von) + 1).find(bleibt) ?? von;
    }
    if (bis !== null && weg.includes(bis)) {
      bis = reihe.slice(0, reihe.indexOf(bis)).reverse().find(bleibt) ?? bis;
    }
    // The whole stay went (e.g. only the lunch that is deleted): keep the gone limits, so the row
    // eats nowhere and says so, instead of an end before the start
    if (von !== null && bis !== null && reihe.indexOf(von) > reihe.indexOf(bis)) {
      von = zeile.von_mahlzeit_id;
      bis = zeile.bis_mahlzeit_id;
    }
    await trx
      .updateTable('essen.teilnehmende')
      .set({ von_mahlzeit_id: von, bis_mahlzeit_id: bis })
      .where('id', '=', zeile.id)
      .execute();
  }
}

/**
 * After meals or days moved: refuses the change when a row of participants would then end before
 * it starts, so nobody silently drops out of the counts.
 */
export async function pruefeAnwesenheit(trx: Db, planungId: number): Promise<void> {
  const zeilen = await trx
    .selectFrom('essen.teilnehmende as z')
    .innerJoin('essen.planung_gruppe as g', 'g.id', 'z.gruppe_id')
    .select(['z.anzahl', 'g.name', 'z.von_mahlzeit_id', 'z.bis_mahlzeit_id'])
    .where('z.planung_id', '=', planungId)
    .where('z.von_mahlzeit_id', 'is not', null)
    .where('z.bis_mahlzeit_id', 'is not', null)
    .execute();
  if (!zeilen.length) return;
  const reihe = await mahlzeitenReihe(trx, planungId);
  const verdreht = zeilen.find((zeile) => {
    const von = reihe.indexOf(zeile.von_mahlzeit_id!);
    const bis = reihe.indexOf(zeile.bis_mahlzeit_id!);
    return von >= 0 && bis >= 0 && von > bis;
  });
  if (verdreht) {
    throw new ValidationError({
      anwesenheit: `Dann wären ${verdreht.anzahl} ${verdreht.name} erst nach ihrem Ende da. Ändere zuerst unter Teilnehmende, ab und bis wann sie mitessen.`,
    });
  }
}
