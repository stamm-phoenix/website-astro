import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  getSqlErrorNumber,
  requireVersion,
  toVersion,
} from './db';
import type {
  EinkaufPosten,
  Geschaeft,
  GeschaeftInput,
  PostenArt,
  PostenInput,
  ZusatzPosten,
} from './essen-einkauf-model';
import { MAX_GESCHAEFTE, MAX_POSTEN } from './essen-einkauf-model';
import { einheitPasst } from './essen-gerichte-model';
import type { Zugang } from './essen-planung';
import { aendere } from './essen-planung';
import { sonstigesDerPlanung, zutatDerPlanung, zutatDerPlanungFuer } from './essen-planung-zutat';
import type { EssenEinheitenart } from './essen-validation';
import { ValidationError } from './validation/errors';

/**
 * Shops, stock and extra needs of a Planung (`docs/essensplanung.md`, Einkaufsliste). Every change
 * runs in `aendere`, which locks the Planung, so the checks here hold until the end.
 */

export interface EinkaufDaten {
  geschaefte: Geschaeft[];
  bestand: EinkaufPosten[];
  zusatzbedarf: ZusatzPosten[];
}

const TABELLE = { bestand: 'essen.bestand', zusatzbedarf: 'essen.zusatzbedarf' } as const;

export async function ladeEinkauf(db: Db, planungId: number): Promise<EinkaufDaten> {
  const [geschaefte, bestand, zusatzbedarf] = await Promise.all([
    db.selectFrom('essen.geschaeft').selectAll().where('planung_id', '=', planungId).execute(),
    db.selectFrom('essen.bestand').selectAll().where('planung_id', '=', planungId).execute(),
    db.selectFrom('essen.zusatzbedarf').selectAll().where('planung_id', '=', planungId).execute(),
  ]);
  const posten = (rows: typeof zusatzbedarf): ZusatzPosten[] =>
    rows
      .map((row) => ({
        id: row.id,
        etag: toVersion(row.version),
        planungZutatId: row.planung_zutat_id,
        menge: row.menge === null ? null : Number(row.menge),
        einheit: row.einheit,
        hinweis: row.hinweis,
      }))
      .sort((a, b) => a.id - b.id);
  return {
    geschaefte: geschaefte
      .map((row) => ({
        id: row.id,
        etag: toVersion(row.version),
        position: row.position,
        name: row.name,
      }))
      .sort((a, b) => a.position - b.position || a.id - b.id),
    // The stock always has an amount (`essen.bestand`)
    bestand: posten(bestand) as EinkaufPosten[],
    zusatzbedarf: posten(zusatzbedarf),
  };
}

// ---------------------------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------------------------

const GESCHAEFT_GIBT_ES = () =>
  new ValidationError({ name: 'Dieses Geschäft gibt es in der Planung schon.' });

async function eindeutig<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (getSqlErrorNumber(error) === 2627 || getSqlErrorNumber(error) === 2601)
      throw GESCHAEFT_GIBT_ES();
    throw error;
  }
}

async function geschaeftDerPlanung(trx: Db, zugang: Zugang, id: number) {
  const geschaeft = await trx
    .selectFrom('essen.geschaeft')
    .select(['id', 'name'])
    .where('id', '=', id)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!geschaeft) throw new RecordNotFoundError();
  return geschaeft;
}

export async function geschaeftAnlegen(zugang: Zugang, input: GeschaeftInput): Promise<void> {
  await aendere(zugang, 'geschaeft-neu', async (trx) => {
    const geschaefte = await trx
      .selectFrom('essen.geschaeft')
      .select('position')
      .where('planung_id', '=', zugang.planungId)
      .execute();
    if (geschaefte.length >= MAX_GESCHAEFTE)
      throw new ValidationError({ name: `Höchstens ${MAX_GESCHAEFTE} Geschäfte.` });
    await eindeutig(() =>
      trx
        .insertInto('essen.geschaeft')
        .values({
          planung_id: zugang.planungId,
          position: Math.max(0, ...geschaefte.map((g) => g.position)) + 1,
          name: input.name,
        })
        .execute()
    );
    return { result: undefined, details: { name: input.name } };
  });
}

export async function geschaeftAendern(
  zugang: Zugang,
  id: number,
  input: GeschaeftInput,
  etag: string
): Promise<void> {
  await aendere(zugang, 'geschaeft-geaendert', async (trx) => {
    const geschaeft = await geschaeftDerPlanung(trx, zugang, id);
    const result = await eindeutig(() =>
      trx
        .updateTable('essen.geschaeft')
        .set({ name: input.name })
        .where('id', '=', id)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst()
    );
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    return {
      result: undefined,
      details: {
        name: input.name,
        ...(geschaeft.name !== input.name ? { vorher: geschaeft.name } : {}),
      },
    };
  });
}

/** Deletes a shop; its ingredients are then bought at no shop. */
export async function geschaeftLoeschen(zugang: Zugang, id: number, etag: string): Promise<void> {
  await aendere(zugang, 'geschaeft-geloescht', async (trx) => {
    const geschaeft = await geschaeftDerPlanung(trx, zugang, id);
    // The ingredients and the shopping trips first (no second cascade path); a conflict below
    // takes this back too; a trip of this shop then covers every shop
    await trx
      .updateTable('essen.einkauf')
      .set({ geschaeft_id: null })
      .where('geschaeft_id', '=', id)
      .execute();
    await trx
      .updateTable('essen.planung_zutat')
      .set({ geschaeft_id: null })
      .where('geschaeft_id', '=', id)
      .execute();
    const result = await trx
      .deleteFrom('essen.geschaeft')
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { name: geschaeft.name } };
  });
}

/**
 * Sets where an ingredient of the Planung is bought; null: at no shop. Only on the version of
 * the ingredient the choice was made on, so the choice of someone else is not overwritten.
 */
export async function zutatGeschaeftSetzen(
  zugang: Zugang,
  planungZutatId: number,
  geschaeftId: number | null,
  etag: string
): Promise<void> {
  await aendere(zugang, 'zutat-geschaeft', async (trx) => {
    const zutat = await zutatDerPlanung(trx, zugang, planungZutatId);
    const geschaeft =
      geschaeftId === null
        ? null
        : await geschaeftDerPlanung(trx, zugang, geschaeftId).catch(() => {
            throw new ValidationError({ geschaeftId: 'Dieses Geschäft gibt es nicht mehr.' });
          });
    const result = await trx
      .updateTable('essen.planung_zutat')
      .set({ geschaeft_id: geschaeftId })
      .where('id', '=', planungZutatId)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    return {
      result: undefined,
      details: { name: zutat.name ?? zutat.z_name, geschaeft: geschaeft?.name ?? null },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Stock and extra needs
// ---------------------------------------------------------------------------------------------

const EINHEITENART_TEXT: Record<EssenEinheitenart, string> = {
  masse: 'g oder kg',
  volumen: 'ml oder l',
  stueck: 'Stück',
  packung: 'Packungen',
  bund: 'Bund',
};

async function postenZutat(
  trx: Parameters<Parameters<typeof aendere>[2]>[0],
  zugang: Zugang,
  input: PostenInput
) {
  // Things that are not food belong here too, such as dish soap; a name of its own becomes such a
  // thing of the Planung, e.g. „Kochhandschuhe“
  const zutat =
    'name' in input.zutat
      ? await sonstigesDerPlanung(trx, zugang, input.zutat.name, input.einheit)
      : await zutatDerPlanungFuer(trx, zugang, input.zutat, { lebensmittel: false });
  if (!einheitPasst(zutat.einheitenart, input.einheit)) {
    throw new ValidationError({
      einheit: `${zutat.name} wird in ${EINHEITENART_TEXT[zutat.einheitenart]} gemessen.`,
    });
  }
  return zutat;
}

export async function postenAnlegen(
  zugang: Zugang,
  art: PostenArt,
  input: PostenInput
): Promise<void> {
  await aendere(zugang, `${art}-neu`, async (trx) => {
    const anzahl = await trx
      .selectFrom(TABELLE[art])
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('planung_id', '=', zugang.planungId)
      .executeTakeFirstOrThrow();
    if (Number(anzahl.count) >= MAX_POSTEN)
      throw new ValidationError({ zutat: `Höchstens ${MAX_POSTEN} Einträge.` });
    const zutat = await postenZutat(trx, zugang, input);
    await trx
      .insertInto(TABELLE[art])
      .values({
        planung_id: zugang.planungId,
        planung_zutat_id: zutat.id,
        menge: input.menge,
        einheit: input.einheit,
        hinweis: input.hinweis,
      })
      .execute();
    return { result: undefined, details: { name: zutat.name } };
  });
}

async function postenDerPlanung(trx: Db, zugang: Zugang, art: PostenArt, id: number) {
  const posten = await trx
    .selectFrom(TABELLE[art])
    .select(['id', 'planung_zutat_id'])
    .where('id', '=', id)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!posten) throw new RecordNotFoundError();
  return posten;
}

export async function postenAendern(
  zugang: Zugang,
  art: PostenArt,
  id: number,
  input: PostenInput,
  etag: string
): Promise<void> {
  await aendere(zugang, `${art}-geaendert`, async (trx) => {
    await postenDerPlanung(trx, zugang, art, id);
    const zutat = await postenZutat(trx, zugang, input);
    const result = await trx
      .updateTable(TABELLE[art])
      .set({
        planung_zutat_id: zutat.id,
        menge: input.menge,
        einheit: input.einheit,
        hinweis: input.hinweis,
      })
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { name: zutat.name } };
  });
}

export async function postenLoeschen(
  zugang: Zugang,
  art: PostenArt,
  id: number,
  etag: string
): Promise<void> {
  await aendere(zugang, `${art}-geloescht`, async (trx) => {
    const posten = await postenDerPlanung(trx, zugang, art, id);
    const zutat = await zutatDerPlanung(trx, zugang, posten.planung_zutat_id);
    const result = await trx
      .deleteFrom(TABELLE[art])
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { name: zutat.name ?? zutat.z_name } };
  });
}
