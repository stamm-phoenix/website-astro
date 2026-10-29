import type { Transaction } from 'kysely';
import type { Db } from './db';
import type { Database } from './db-schema';
import { RecordNotFoundError, lockResource } from './db';
import { MAX_PLANUNG_ZUTATEN, zutatSperre } from './essen-gerichte-model';
import type { Zugang } from './essen-planung';
import type { EssenEinheitenart } from './essen-validation';
import { ValidationError } from './validation/errors';

/**
 * The ingredients of a Planung as the lines of dishes, the stock and the extra needs pick them: one
 * of the Planung's own, or a central one, which then becomes an ingredient of the Planung.
 */

/** An ingredient of the Planung with what its central one says. */
export async function zutatDerPlanung(trx: Db, zugang: Zugang, id: number) {
  const zutat = await trx
    .selectFrom('essen.planung_zutat as pz')
    .leftJoin('essen.zutat as z', 'z.id', 'pz.zutat_id')
    .select([
      'pz.id',
      'pz.zutat_id',
      'pz.name',
      'pz.einheitenart',
      'z.name as z_name',
      'z.einheitenart as z_einheitenart',
      'z.lebensmittel as z_lebensmittel',
    ])
    .where('pz.id', '=', id)
    .where('pz.planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!zutat) throw new RecordNotFoundError();
  return zutat;
}

const keinLebensmittel = (name: string) =>
  new ValidationError({ zutat: `${name} ist kein Lebensmittel und gehört in kein Gericht.` });

/** What picks an ingredient: one of the Planung, or one of the central list. */
export type ZutatWahl = { zutatId: number } | { planungZutatId: number };

/**
 * The ingredient of the Planung that `wahl` picks; a central one is added to the Planung first.
 * With `lebensmittel` (lines of dishes), things that are not food are refused.
 */
export async function zutatDerPlanungFuer(
  trx: Transaction<Database>,
  zugang: Zugang,
  wahl: ZutatWahl,
  { lebensmittel }: { lebensmittel: boolean }
): Promise<{ id: number; name: string; einheitenart: EssenEinheitenart }> {
  if ('planungZutatId' in wahl) {
    const row = await zutatDerPlanung(trx, zugang, wahl.planungZutatId).catch(() => null);
    if (!row) throw new ValidationError({ zutat: 'Bitte eine Zutat wählen.' });
    // The Steuerung may have marked a central ingredient as not food since it was first used
    if (lebensmittel && row.zutat_id !== null && !row.z_lebensmittel)
      throw keinLebensmittel(row.z_name ?? '');
    // The kind of unit inherited from the central list stays until the line is saved
    if (row.zutat_id !== null && row.einheitenart === null) {
      await lockResource(trx, zutatSperre(row.zutat_id));
    }
    return {
      id: row.id,
      name: (row.name ?? row.z_name)!,
      einheitenart: (row.einheitenart ?? row.z_einheitenart)!,
    };
  }
  await lockResource(trx, zutatSperre(wahl.zutatId));
  const zentral = await trx
    .selectFrom('essen.zutat')
    .select(['id', 'name', 'einheitenart', 'lebensmittel'])
    .where('id', '=', wahl.zutatId)
    .executeTakeFirst();
  if (!zentral) throw new ValidationError({ zutat: 'Bitte eine Zutat wählen.' });
  if (lebensmittel && !zentral.lebensmittel) throw keinLebensmittel(zentral.name);
  const vorhanden = await trx
    .selectFrom('essen.planung_zutat')
    .select(['id', 'einheitenart'])
    .where('planung_id', '=', zugang.planungId)
    .where('zutat_id', '=', zentral.id)
    .executeTakeFirst();
  if (vorhanden) {
    return {
      id: vorhanden.id,
      name: zentral.name,
      einheitenart: vorhanden.einheitenart ?? zentral.einheitenart,
    };
  }
  const anzahl = await trx
    .selectFrom('essen.planung_zutat')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirstOrThrow();
  if (Number(anzahl.count) >= MAX_PLANUNG_ZUTATEN) {
    throw new ValidationError({
      zutat: `Eine Planung hat höchstens ${MAX_PLANUNG_ZUTATEN} Zutaten.`,
    });
  }
  const { id } = await trx
    .insertInto('essen.planung_zutat')
    .values({ planung_id: zugang.planungId, zutat_id: zentral.id })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  return { id, name: zentral.name, einheitenart: zentral.einheitenart };
}
