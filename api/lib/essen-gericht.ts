import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  lockResource,
  requireVersion,
  toVersion,
} from './db';
import { MAX_GERICHTE, gerichtSperre, gerichtStand } from './essen-gerichte-model';
import type { GerichtInput } from './essen-gerichte-validation';
import type { Zugang } from './essen-planung';
import { aendere } from './essen-planung';
import { fuegeEinplanungEin, sortiere as sortiereEinplanungen } from './essen-einplanung';
import type { EinplanungInput } from './essen-planung-model';
import { eindeutig, zaehle } from './essen-gerichte';
import { ValidationError } from './validation/errors';

/**
 * The dishes of a Planung themselves: adding (optionally planned at a meal in the same change),
 * changing the fields and deleting with their lines and places (`docs/essensplanung.md`,
 * „Gerichte“). Their lines are in `essen-gericht-zeilen.ts`.
 */

const GERICHT_GIBT_ES = 'Ein Gericht mit diesem Namen gibt es in dieser Planung schon.';

/**
 * Adds a dish; returns its id. With `einplanung` it is planned at that meal in the same change,
 * so a name typed into a slot of the plan is a dish there at once.
 */
export async function gerichtAnlegen(
  zugang: Zugang,
  input: GerichtInput,
  einplanung?: Omit<EinplanungInput, 'gerichtId'>
): Promise<number> {
  return eindeutig('name', GERICHT_GIBT_ES, () =>
    aendere(zugang, 'gericht-neu', async (trx) => {
      if ((await zaehle(trx, 'essen.gericht', zugang.planungId)) >= MAX_GERICHTE) {
        throw new ValidationError({ name: `Eine Planung hat höchstens ${MAX_GERICHTE} Gerichte.` });
      }
      const { id } = await trx
        .insertInto('essen.gericht')
        .values({
          planung_id: zugang.planungId,
          name: input.name!,
          personen: input.personen ?? null,
          ...(input.anleitung !== undefined ? { anleitung: input.anleitung } : {}),
          ...(input.notiz !== undefined ? { notiz: input.notiz } : {}),
          ...(input.links !== undefined ? { links: JSON.stringify(input.links) } : {}),
          ...(input.werkzeuge !== undefined ? { werkzeuge: JSON.stringify(input.werkzeuge) } : {}),
        })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      const platz = einplanung
        ? await fuegeEinplanungEin(trx, zugang, { ...einplanung, gerichtId: id })
        : {};
      return { result: id, details: { name: input.name, ...platz } };
    })
  );
}

export async function gerichtDerPlanung(trx: Db, zugang: Zugang, id: number) {
  const gericht = await trx
    .selectFrom('essen.gericht')
    .select(['id', 'name', 'version', 'personen'])
    .where('id', '=', id)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!gericht) throw new RecordNotFoundError();
  return gericht;
}

/** Changes the fields sent; the version covers name, people, text, links and tools. */
export async function gerichtAendern(
  zugang: Zugang,
  id: number,
  input: GerichtInput,
  etag: string
): Promise<void> {
  await eindeutig('name', GERICHT_GIBT_ES, () =>
    aendere(zugang, 'gericht-geaendert', async (trx) => {
      const gericht = await gerichtDerPlanung(trx, zugang, id);
      const result = await trx
        .updateTable('essen.gericht')
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.personen !== undefined ? { personen: input.personen } : {}),
          ...(input.anleitung !== undefined ? { anleitung: input.anleitung } : {}),
          ...(input.notiz !== undefined ? { notiz: input.notiz } : {}),
          ...(input.links !== undefined ? { links: JSON.stringify(input.links) } : {}),
          ...(input.werkzeuge !== undefined ? { werkzeuge: JSON.stringify(input.werkzeuge) } : {}),
        })
        .where('id', '=', id)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
      return {
        result: undefined,
        details: {
          name: input.name ?? gericht.name,
          ...(input.name !== undefined && input.name !== gericht.name
            ? { vorher: gericht.name }
            : {}),
        },
      };
    })
  );
}

/**
 * Deletes a dish with its lines and where it is planned; `etag` is its `gerichtStand`, covering
 * those too.
 */
export async function gerichtLoeschen(zugang: Zugang, id: number, etag: string): Promise<void> {
  await aendere(zugang, 'gericht-geloescht', async (trx) => {
    // No line changes meanwhile; they take the same lock
    await lockResource(trx, gerichtSperre(id));
    const gericht = await gerichtDerPlanung(trx, zugang, id);
    const zeilen = await trx
      .selectFrom('essen.gericht_zutat')
      .select('version')
      .where('gericht_id', '=', id)
      .execute();
    const einplanungen = await trx
      .selectFrom('essen.einplanung')
      .select(['version', 'mahlzeit_id'])
      .where('gericht_id', '=', id)
      .execute();
    const stand = gerichtStand(
      {
        etag: toVersion(gericht.version),
        zutaten: zeilen.map((zeile) => ({ etag: toVersion(zeile.version) })),
      },
      einplanungen.map((einplanung) => toVersion(einplanung.version))
    );
    if (stand !== etag.trim()) throw new VersionConflictError();
    // Its places in the plan go with it; they point to the dish without a cascade
    await trx.deleteFrom('essen.einplanung').where('gericht_id', '=', id).execute();
    // The dishes after it in those meals move up
    for (const mahlzeitId of new Set(einplanungen.map((einplanung) => einplanung.mahlzeit_id))) {
      await sortiereEinplanungen(trx, mahlzeitId, null);
    }
    const result = await trx
      .deleteFrom('essen.gericht')
      .where('id', '=', id)
      .where('version', '=', gericht.version)
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { name: gericht.name } };
  });
}
