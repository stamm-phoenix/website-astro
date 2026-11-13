import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  toDateString,
  toVersion,
  requireRowversion,
} from './db';
import type { MahlzeitInput } from './essen-planung-model';
import { MAX_MAHLZEITEN_PRO_TAG, neuesteVersion } from './essen-planung-model';
import { aendere } from './essen-aendern';
import { nummeriereMahlzeiten } from './essen-mahlzeiten-reihenfolge';
import type { Zugang } from './essen-zugang';
import { pruefeAnwesenheit, verschiebeGrenzen } from './essen-teilnehmende-grenzen';
import { ValidationError } from './validation/errors';
import { tagDerPlanung } from './essen-planung-tage';

export async function mahlzeitHinzufuegen(
  zugang: Zugang,
  tagId: number,
  input: MahlzeitInput,
  position?: number
): Promise<void> {
  await aendere(zugang, 'mahlzeit-neu', async (trx) => {
    const tag = await tagDerPlanung(trx, zugang, tagId);
    const anzahl = await trx
      .selectFrom('essen.mahlzeit')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('tag_id', '=', tagId)
      .executeTakeFirstOrThrow();
    if (Number(anzahl.count) >= MAX_MAHLZEITEN_PRO_TAG) {
      throw new ValidationError({
        name: `Ein Tag hat höchstens ${MAX_MAHLZEITEN_PRO_TAG} Mahlzeiten.`,
      });
    }
    const mahlzeit = await trx
      .insertInto('essen.mahlzeit')
      .values({
        tag_id: tagId,
        position: Number(anzahl.count) + 1,
        name: input.name,
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    if (position !== undefined) {
      await nummeriereMahlzeiten(trx, tagId, { id: mahlzeit.id, position });
    }
    return { result: undefined, details: { name: input.name, datum: toDateString(tag.datum) } };
  });
}

async function mahlzeitDerPlanung(trx: Db, zugang: Zugang, mahlzeitId: number) {
  const mahlzeit = await trx
    .selectFrom('essen.mahlzeit as m')
    .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
    .select(['m.id', 'm.version', 'm.tag_id', 'm.name', 't.datum'])
    .where('m.id', '=', mahlzeitId)
    .where('t.planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!mahlzeit) throw new RecordNotFoundError();
  return mahlzeit;
}

export async function mahlzeitAendern(
  zugang: Zugang,
  mahlzeitId: number,
  input: MahlzeitInput & { position?: number },
  etag: string
): Promise<void> {
  await aendere(zugang, 'mahlzeit-geaendert', async (trx) => {
    const mahlzeit = await mahlzeitDerPlanung(trx, zugang, mahlzeitId);
    const result = await trx
      .updateTable('essen.mahlzeit')
      .set({ name: input.name })
      .where('id', '=', mahlzeitId)
      .where('version', '=', requireRowversion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    if (input.position !== undefined) {
      await nummeriereMahlzeiten(trx, mahlzeit.tag_id, {
        id: mahlzeitId,
        position: input.position,
      });
      await pruefeAnwesenheit(trx, zugang.planungId);
    }
    return {
      result: undefined,
      details: {
        name: input.name,
        ...(mahlzeit.name !== input.name ? { vorher: mahlzeit.name } : {}),
        datum: toDateString(mahlzeit.datum),
      },
    };
  });
}

export async function mahlzeitLoeschen(
  zugang: Zugang,
  mahlzeitId: number,
  etag: string
): Promise<void> {
  await aendere(zugang, 'mahlzeit-geloescht', async (trx) => {
    const mahlzeit = await mahlzeitDerPlanung(trx, zugang, mahlzeitId);
    // `etag` is the `mahlzeitStand`: a dish planned or changed meanwhile is a conflict
    const einplanungen = await trx
      .selectFrom('essen.einplanung')
      .select('version')
      .where('mahlzeit_id', '=', mahlzeitId)
      .execute();
    const stand = neuesteVersion([
      toVersion(mahlzeit.version),
      ...einplanungen.map((einplanung) => toVersion(einplanung.version)),
    ]);
    if (stand !== etag.trim()) throw new VersionConflictError();
    await verschiebeGrenzen(trx, zugang.planungId, [mahlzeitId]);
    const result = await trx
      .deleteFrom('essen.mahlzeit')
      .where('id', '=', mahlzeitId)
      .where('version', '=', mahlzeit.version)
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    // Close the gap in the order
    await nummeriereMahlzeiten(trx, mahlzeit.tag_id);
    return {
      result: undefined,
      details: { name: mahlzeit.name, datum: toDateString(mahlzeit.datum) },
    };
  });
}
