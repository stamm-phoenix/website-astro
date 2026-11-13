import { sql } from 'kysely';
import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  getSqlErrorNumber,
  inTransaction,
  requireVersion,
} from './db';
import type { ZutatInput } from './essen-validation';
import { audit, readRouteId } from './essen-audit';
import { listZutaten } from './essen-steuerung';
import { katalogGeaendert } from './essen-katalog-stand';
import type { FieldErrors } from './validation/errors';
import { ValidationError } from './validation/errors';

/**
 * Writing the central lists of the Essensplanung (ingredients, categories, allergens) in the
 * Steuerung. Each change bumps the catalog counter (`katalogGeaendert`) after its write in the
 * same transaction, which the polling pages read instead of scanning the lists.
 */

const DUPLICATE_KEY = new Set([2601, 2627]);

/** Turns a unique key violation of a name into a field error. */
async function uniqueName<T>(message: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    const number = getSqlErrorNumber(error);
    if (number !== undefined && DUPLICATE_KEY.has(number)) {
      throw new ValidationError({ name: message });
    }
    throw error;
  }
}

/** Throws the right error after an update or delete with an outdated version changed nothing. */
async function notChanged(
  db: Db,
  table: 'essen.zutat' | 'essen.kategorie' | 'essen.unvertraeglichkeit',
  id: number
): Promise<never> {
  const exists = await db.selectFrom(table).select('id').where('id', '=', id).executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

async function checkReferences(db: Db, input: ZutatInput): Promise<void> {
  const errors: FieldErrors = {};
  const kategorie = await db
    .selectFrom('essen.kategorie')
    .select('id')
    .where('id', '=', input.kategorieId)
    .executeTakeFirst();
  if (!kategorie) errors.kategorieId = 'Diese Kategorie gibt es nicht mehr. Bitte neu laden.';
  if (input.allergene.length) {
    const found = await db
      .selectFrom('essen.unvertraeglichkeit')
      .select('id')
      .where('id', 'in', input.allergene)
      .execute();
    if (found.length !== input.allergene.length) {
      errors.allergene = 'Eine der Unverträglichkeiten gibt es nicht mehr. Bitte neu laden.';
    }
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

function zutatColumns(input: ZutatInput, actor: string) {
  return {
    name: input.name,
    kategorie_id: input.kategorieId,
    einheitenart: input.einheitenart,
    abtropfgewicht: input.abtropfgewicht,
    lebensmittel: input.lebensmittel,
    vegetarisch: input.vegetarisch,
    vegan: input.vegan,
    merkmale_geprueft: input.merkmaleGeprueft,
    hinweis: input.hinweis,
    gramm_pro_tl: input.grammProTl,
    gramm_pro_el: input.grammProEl,
    gramm_pro_stueck: input.grammProStueck,
    geaendert_von: actor,
  };
}

async function setAllergene(db: Db, zutatId: number, allergene: number[]): Promise<void> {
  await db.deleteFrom('essen.zutat_unvertraeglichkeit').where('zutat_id', '=', zutatId).execute();
  if (allergene.length) {
    await db
      .insertInto('essen.zutat_unvertraeglichkeit')
      .values(allergene.map((id) => ({ zutat_id: zutatId, unvertraeglichkeit_id: id })))
      .execute();
  }
}

const ZUTAT_EXISTS = 'Eine Zutat mit diesem Namen gibt es schon.';

export async function createZutat(input: ZutatInput, actor: string): Promise<number> {
  return uniqueName(ZUTAT_EXISTS, () =>
    inTransaction(async (trx) => {
      await checkReferences(trx, input);
      const { id } = await trx
        .insertInto('essen.zutat')
        .values(zutatColumns(input, actor))
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      await setAllergene(trx, id, input.allergene);
      await katalogGeaendert(trx);
      await audit(trx, actor, 'zutat-angelegt', { id, name: input.name });
      return id;
    })
  );
}

const ZUTAT_FIELDS: Record<keyof ZutatInput, string> = {
  name: 'name',
  kategorieId: 'kategorie',
  einheitenart: 'einheit',
  abtropfgewicht: 'abtropfgewicht',
  lebensmittel: 'lebensmittel',
  vegetarisch: 'vegetarisch',
  vegan: 'vegan',
  merkmaleGeprueft: 'geprueft',
  hinweis: 'hinweis',
  grammProTl: 'umrechnung',
  grammProEl: 'umrechnung',
  grammProStueck: 'umrechnung',
  allergene: 'allergene',
};

/** Saves an ingredient if it still has the version `etag`. */
export async function updateZutat(
  id: string,
  input: ZutatInput,
  etag: string,
  actor: string
): Promise<void> {
  const numericId = readRouteId(id);
  await uniqueName(ZUTAT_EXISTS, () =>
    inTransaction(async (trx) => {
      await checkReferences(trx, input);
      const before = (await listZutaten(trx)).find((zutat) => zutat.id === numericId);
      const result = await trx
        .updateTable('essen.zutat')
        .set({ ...zutatColumns(input, actor), geaendert_am: sql<Date>`SYSUTCDATETIME()` })
        .where('id', '=', numericId)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) await notChanged(trx, 'essen.zutat', numericId);
      await setAllergene(trx, numericId, input.allergene);
      const changes = before
        ? [
            ...new Set(
              (Object.keys(ZUTAT_FIELDS) as (keyof ZutatInput)[])
                .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(input[key]))
                .map((key) => ZUTAT_FIELDS[key])
            ),
          ]
        : [];
      await katalogGeaendert(trx);
      await audit(trx, actor, 'zutat-geaendert', {
        id: numericId,
        name: input.name,
        ...(before && before.name !== input.name ? { vorher: before.name } : {}),
        changes,
      });
    })
  );
}

export async function deleteZutat(id: string, etag: string, actor: string): Promise<void> {
  const numericId = readRouteId(id);
  await inTransaction(async (trx) => {
    const row = await trx
      .selectFrom('essen.zutat')
      .select('name')
      .where('id', '=', numericId)
      .executeTakeFirst();
    // Planungen that use the ingredient keep it: the foreign key refuses the deletion
    let deleted: bigint;
    try {
      const result = await trx
        .deleteFrom('essen.zutat')
        .where('id', '=', numericId)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      deleted = result.numDeletedRows;
    } catch (error: unknown) {
      if (getSqlErrorNumber(error) !== 547) throw error;
      throw new ValidationError({
        name: 'Planungen nutzen diese Zutat. Sie bleibt in der Liste; ändern geht.',
      });
    }
    if (Number(deleted) === 0) await notChanged(trx, 'essen.zutat', numericId);
    await katalogGeaendert(trx);
    await audit(trx, actor, 'zutat-geloescht', { id: numericId, name: row?.name ?? '' });
  });
}

const KATEGORIE_EXISTS = 'Eine Kategorie mit diesem Namen gibt es schon.';

export async function createKategorie(name: string, actor: string): Promise<number> {
  return uniqueName(KATEGORIE_EXISTS, () =>
    inTransaction(async (trx) => {
      const { id } = await trx
        .insertInto('essen.kategorie')
        .values({ name })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      await katalogGeaendert(trx);
      await audit(trx, actor, 'kategorie-angelegt', { id, name });
      return id;
    })
  );
}

export async function renameKategorie(
  id: string,
  name: string,
  etag: string,
  actor: string
): Promise<void> {
  const numericId = readRouteId(id);
  await uniqueName(KATEGORIE_EXISTS, () =>
    inTransaction(async (trx) => {
      const before = await trx
        .selectFrom('essen.kategorie')
        .select('name')
        .where('id', '=', numericId)
        .executeTakeFirst();
      const result = await trx
        .updateTable('essen.kategorie')
        .set({ name })
        .where('id', '=', numericId)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) await notChanged(trx, 'essen.kategorie', numericId);
      await katalogGeaendert(trx);
      await audit(trx, actor, 'kategorie-umbenannt', { id: numericId, name, vorher: before?.name });
    })
  );
}

export async function deleteKategorie(id: string, etag: string, actor: string): Promise<void> {
  const numericId = readRouteId(id);
  await inTransaction(async (trx) => {
    const row = await trx
      .selectFrom('essen.kategorie')
      .select('name')
      .where('id', '=', numericId)
      .executeTakeFirst();
    // The foreign key decides whether ingredients still use the category, so an ingredient
    // moved into it at the same moment cannot slip past a separate check
    let deleted: bigint;
    try {
      const result = await trx
        .deleteFrom('essen.kategorie')
        .where('id', '=', numericId)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      deleted = result.numDeletedRows;
    } catch (error: unknown) {
      if (getSqlErrorNumber(error) !== 547) throw error;
      throw new ValidationError({
        name: 'Zu dieser Kategorie gehören noch Zutaten. Ordne sie zuerst einer anderen zu.',
      });
    }
    if (Number(deleted) === 0) await notChanged(trx, 'essen.kategorie', numericId);
    await katalogGeaendert(trx);
    await audit(trx, actor, 'kategorie-geloescht', { id: numericId, name: row?.name ?? '' });
  });
}

const UNVERTRAEGLICHKEIT_EXISTS = 'Eine Unverträglichkeit mit diesem Namen gibt es schon.';

export async function createUnvertraeglichkeit(name: string, actor: string): Promise<number> {
  return uniqueName(UNVERTRAEGLICHKEIT_EXISTS, () =>
    inTransaction(async (trx) => {
      const { id } = await trx
        .insertInto('essen.unvertraeglichkeit')
        .values({ name, schluessel: null })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      await katalogGeaendert(trx);
      await audit(trx, actor, 'unvertraeglichkeit-angelegt', { id, name });
      return id;
    })
  );
}

export async function renameUnvertraeglichkeit(
  id: string,
  name: string,
  etag: string,
  actor: string
): Promise<void> {
  const numericId = readRouteId(id);
  await uniqueName(UNVERTRAEGLICHKEIT_EXISTS, () =>
    inTransaction(async (trx) => {
      const before = await trx
        .selectFrom('essen.unvertraeglichkeit')
        .select('name')
        .where('id', '=', numericId)
        .executeTakeFirst();
      const result = await trx
        .updateTable('essen.unvertraeglichkeit')
        .set({ name })
        .where('id', '=', numericId)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) {
        await notChanged(trx, 'essen.unvertraeglichkeit', numericId);
      }
      await katalogGeaendert(trx);
      await audit(trx, actor, 'unvertraeglichkeit-umbenannt', {
        id: numericId,
        name,
        vorher: before?.name,
      });
    })
  );
}

/** Deletes an allergen added in the Steuerung; the 14 EU allergens stay. */
export async function deleteUnvertraeglichkeit(
  id: string,
  etag: string,
  actor: string
): Promise<void> {
  const numericId = readRouteId(id);
  await inTransaction(async (trx) => {
    const row = await trx
      .selectFrom('essen.unvertraeglichkeit')
      .select(['name', 'schluessel'])
      .where('id', '=', numericId)
      .executeTakeFirst();
    if (row?.schluessel) {
      throw new ValidationError({
        name: 'Die 14 Hauptallergene der EU bleiben in der Liste; umbenennen geht.',
      });
    }
    let deleted: bigint;
    try {
      const result = await trx
        .deleteFrom('essen.unvertraeglichkeit')
        .where('id', '=', numericId)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      deleted = result.numDeletedRows;
    } catch (error: unknown) {
      if (getSqlErrorNumber(error) !== 547) throw error;
      throw new ValidationError({
        name: 'Gerichte oder Zutaten von Planungen nutzen diese Unverträglichkeit. Sie bleibt in der Liste.',
      });
    }
    if (Number(deleted) === 0) await notChanged(trx, 'essen.unvertraeglichkeit', numericId);
    await katalogGeaendert(trx);
    await audit(trx, actor, 'unvertraeglichkeit-geloescht', {
      id: numericId,
      name: row?.name ?? '',
    });
  });
}
