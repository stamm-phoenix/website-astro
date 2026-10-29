import type { Transaction } from 'kysely';
import type { Db } from './db';
import { RecordNotFoundError, VersionConflictError, lockResource, requireVersion } from './db';
import type { Database } from './db-schema';
import type { GerichtEinheit } from './essen-gerichte-model';
import { MAX_ZEILEN_PRO_GERICHT, einheitPasst, gerichtSperre } from './essen-gerichte-model';
import type { GerichtZutatInput } from './essen-gerichte-validation';
import { gerichtDerPlanung, pruefeVerweise } from './essen-gerichte';
import type { Zugang } from './essen-planung';
import { PlanungError, aendere } from './essen-planung';
import { zutatDerPlanungFuer } from './essen-planung-zutat';
import type { EssenEinheitenart } from './essen-validation';
import { ValidationError } from './validation/errors';

/**
 * The lines of a dish (`docs/essensplanung.md`, „Gerichte“): adding one or several, changing,
 * moving and deleting. Like every change of a Planung they run through `aendere()`.
 */

/** Moves line `zeileId` to `position`; without both it only closes gaps in the order. */
async function sortiereZeilen(
  trx: Db,
  gerichtId: number,
  zeileId: number | null,
  position?: number
): Promise<void> {
  const zeilen = await trx
    .selectFrom('essen.gericht_zutat')
    .select(['id', 'position'])
    .where('gericht_id', '=', gerichtId)
    .orderBy('position')
    .orderBy('id')
    .execute();
  const ids = zeilen.map((zeile) => zeile.id).filter((id) => id !== zeileId);
  if (zeileId !== null && position !== undefined) {
    ids.splice(Math.min(Math.max(position - 1, 0), ids.length), 0, zeileId);
  }
  for (const [index, id] of ids.entries()) {
    if (zeilen.find((zeile) => zeile.id === id)?.position !== index + 1) {
      await trx
        .updateTable('essen.gericht_zutat')
        .set({ position: index + 1 })
        .where('id', '=', id)
        .execute();
    }
  }
}

async function setzeUnvertraeglichkeiten(trx: Db, zeileId: number, input: GerichtZutatInput) {
  await pruefeVerweise(trx, null, [...input.ohne, ...input.nur], 'ohne');
  await trx
    .deleteFrom('essen.gericht_zutat_unvertraeglichkeit')
    .where('gericht_zutat_id', '=', zeileId)
    .execute();
  const rows = [
    ...input.ohne.map((id) => ({
      gericht_zutat_id: zeileId,
      unvertraeglichkeit_id: id,
      nur: false,
    })),
    ...input.nur.map((id) => ({ gericht_zutat_id: zeileId, unvertraeglichkeit_id: id, nur: true })),
  ];
  if (rows.length)
    await trx.insertInto('essen.gericht_zutat_unvertraeglichkeit').values(rows).execute();
}

function zeilenWerte(input: GerichtZutatInput, planungZutatId: number) {
  return {
    planung_zutat_id: planungZutatId,
    menge: input.menge,
    einheit: input.einheit as GerichtEinheit | null,
    fest: input.fest,
    fuer_alles: input.fuerAlles,
    fuer_vegetarisch: input.fuerVegetarisch,
    fuer_vegan: input.fuerVegan,
    hinweis: input.hinweis,
  };
}

function pruefeEinheit(
  zutat: { name: string; einheitenart: EssenEinheitenart },
  input: GerichtZutatInput
) {
  if (!einheitPasst(zutat.einheitenart, input.einheit)) {
    throw new ValidationError({
      einheit: `${zutat.name} wird in ${EINHEITENART_TEXT[zutat.einheitenart]} gemessen.`,
    });
  }
}

const EINHEITENART_TEXT: Record<EssenEinheitenart, string> = {
  masse: 'g oder kg',
  volumen: 'ml oder l',
  stueck: 'Stück',
  packung: 'Packungen',
  bund: 'Bund',
};

/** The number of lines of a dish; refuses `neu` more beyond the limit. */
async function pruefeAnzahl(trx: Db, gerichtId: number, neu: number): Promise<number> {
  const anzahl = await trx
    .selectFrom('essen.gericht_zutat')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('gericht_id', '=', gerichtId)
    .executeTakeFirstOrThrow();
  if (Number(anzahl.count) + neu > MAX_ZEILEN_PRO_GERICHT) {
    throw new ValidationError({
      zutat: `Ein Gericht hat höchstens ${MAX_ZEILEN_PRO_GERICHT} Zutaten.`,
    });
  }
  return Number(anzahl.count);
}

/** Inserts a line at `position` (1-based, at the end of the lines counted); returns its name. */
async function fuegeZeileEin(
  trx: Transaction<Database>,
  zugang: Zugang,
  gerichtId: number,
  input: GerichtZutatInput,
  position: number
): Promise<{ id: number; name: string }> {
  const zutat = await zutatDerPlanungFuer(trx, zugang, input.zutat, { lebensmittel: true });
  pruefeEinheit(zutat, input);
  const { id } = await trx
    .insertInto('essen.gericht_zutat')
    .values({ gericht_id: gerichtId, position, ...zeilenWerte(input, zutat.id) })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  await setzeUnvertraeglichkeiten(trx, id, input);
  return { id, name: zutat.name };
}

/** Adds a line to a dish, at the end or at `position`. */
export async function gerichtZutatAnlegen(
  zugang: Zugang,
  gerichtId: number,
  input: GerichtZutatInput,
  position?: number
): Promise<void> {
  await aendere(zugang, 'gericht-zutat-neu', async (trx) => {
    const gericht = await gerichtDerPlanung(trx, zugang, gerichtId);
    await lockResource(trx, gerichtSperre(gerichtId));
    const anzahl = await pruefeAnzahl(trx, gerichtId, 1);
    const { id, name } = await fuegeZeileEin(trx, zugang, gerichtId, input, anzahl + 1);
    if (position !== undefined) await sortiereZeilen(trx, gerichtId, id, position);
    return { result: undefined, details: { name, gericht: gericht.name } };
  });
}

/** The amounts were scaled for another number of people than the dish has now. */
export function personenGeaendert(personen: number): PlanungError {
  return new PlanungError(
    409,
    'PERSONEN_GEAENDERT',
    `Die Personenzahl des Gerichts wurde inzwischen auf ${personen} geändert. Die Mengen sind für die alte Zahl gerechnet; bitte umrechnen und noch einmal übernehmen.`
  );
}

/**
 * Adds several lines at the end of a dish in one change, e.g. those read from a recipe: all or
 * none. An error of a line names its field as `zeilen.<index>.<field>`. With `personen`, the
 * amounts were scaled for that many people: if the dish has another number by now, nothing is
 * added (409 `PERSONEN_GEAENDERT`).
 */
export async function gerichtZutatenSammeln(
  zugang: Zugang,
  gerichtId: number,
  inputs: GerichtZutatInput[],
  personen?: number
): Promise<void> {
  await aendere(zugang, 'gericht-zutaten-neu', async (trx) => {
    const gericht = await gerichtDerPlanung(trx, zugang, gerichtId);
    await lockResource(trx, gerichtSperre(gerichtId));
    // Read after the Planung is locked by `aendere`, so a change of the people cannot slip in
    if (personen !== undefined && gericht.personen !== personen)
      throw personenGeaendert(gericht.personen);
    const anzahl = await pruefeAnzahl(trx, gerichtId, inputs.length);
    const namen: string[] = [];
    for (const [index, input] of inputs.entries()) {
      try {
        namen.push((await fuegeZeileEin(trx, zugang, gerichtId, input, anzahl + index + 1)).name);
      } catch (error: unknown) {
        if (!(error instanceof ValidationError)) throw error;
        throw new ValidationError(
          Object.fromEntries(
            Object.entries(error.fields).map(([feld, text]) => [`zeilen.${index}.${feld}`, text])
          )
        );
      }
    }
    return {
      result: undefined,
      details: { gericht: gericht.name, anzahl: namen.length, namen: namen.slice(0, 10) },
    };
  });
}

async function zeileDerPlanung(trx: Db, zugang: Zugang, id: number) {
  const zeile = await trx
    .selectFrom('essen.gericht_zutat as gz')
    .innerJoin('essen.gericht as g', 'g.id', 'gz.gericht_id')
    .select(['gz.id', 'gz.gericht_id', 'g.name as gericht'])
    .where('gz.id', '=', id)
    .where('g.planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!zeile) throw new RecordNotFoundError();
  return zeile;
}

/** Changes a line, optionally moving it to `position`. */
export async function gerichtZutatAendern(
  zugang: Zugang,
  id: number,
  input: GerichtZutatInput & { position?: number },
  etag: string
): Promise<void> {
  await aendere(zugang, 'gericht-zutat-geaendert', async (trx) => {
    const zeile = await zeileDerPlanung(trx, zugang, id);
    await lockResource(trx, gerichtSperre(zeile.gericht_id));
    const zutat = await zutatDerPlanungFuer(trx, zugang, input.zutat, { lebensmittel: true });
    pruefeEinheit(zutat, input);
    const result = await trx
      .updateTable('essen.gericht_zutat')
      .set(zeilenWerte(input, zutat.id))
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    await setzeUnvertraeglichkeiten(trx, id, input);
    if (input.position !== undefined) {
      await sortiereZeilen(trx, zeile.gericht_id, id, input.position);
    }
    return { result: undefined, details: { name: zutat.name, gericht: zeile.gericht } };
  });
}

/** Deletes a line; the ones after it move up. */
export async function gerichtZutatLoeschen(
  zugang: Zugang,
  id: number,
  etag: string
): Promise<void> {
  await aendere(zugang, 'gericht-zutat-geloescht', async (trx) => {
    const zeile = await zeileDerPlanung(trx, zugang, id);
    await lockResource(trx, gerichtSperre(zeile.gericht_id));
    const name = await trx
      .selectFrom('essen.gericht_zutat as gz')
      .innerJoin('essen.planung_zutat as pz', 'pz.id', 'gz.planung_zutat_id')
      .leftJoin('essen.zutat as z', 'z.id', 'pz.zutat_id')
      .select(['pz.name', 'z.name as z_name'])
      .where('gz.id', '=', id)
      .executeTakeFirst();
    const result = await trx
      .deleteFrom('essen.gericht_zutat')
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    await sortiereZeilen(trx, zeile.gericht_id, null);
    return {
      result: undefined,
      details: { name: name?.name ?? name?.z_name ?? '', gericht: zeile.gericht },
    };
  });
}
