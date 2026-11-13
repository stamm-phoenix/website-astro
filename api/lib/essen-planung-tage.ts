import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  toDateString,
  toVersion,
  requireRowversion,
} from './db';
import { MAX_TAGE, neuesteVersion } from './essen-planung-model';
import { loadEssenEinstellungen } from './essen-steuerung';
import { aendere } from './essen-aendern';
import type { Zugang } from './essen-zugang';
import { pruefeAnwesenheit, verschiebeGrenzen } from './essen-teilnehmende-grenzen';
import { ValidationError } from './validation/errors';

export async function tagDerPlanung(trx: Db, zugang: Zugang, tagId: number) {
  const tag = await trx
    .selectFrom('essen.tag')
    .selectAll()
    .where('id', '=', tagId)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!tag) throw new RecordNotFoundError();
  return tag;
}

const TAG_GIBT_ES = () =>
  new ValidationError({ datum: 'Diesen Tag gibt es in der Planung schon.' });

export async function tagHinzufuegen(zugang: Zugang, datum: string): Promise<void> {
  await aendere(zugang, 'tag-neu', async (trx) => {
    const tage = await trx
      .selectFrom('essen.tag')
      .select('datum')
      .where('planung_id', '=', zugang.planungId)
      .execute();
    if (tage.some((tag) => toDateString(tag.datum) === datum)) throw TAG_GIBT_ES();
    if (tage.length >= MAX_TAGE) {
      throw new ValidationError({ datum: `Eine Planung hat höchstens ${MAX_TAGE} Tage.` });
    }
    const tag = await trx
      .insertInto('essen.tag')
      .values({ planung_id: zugang.planungId, datum })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    const { einstellungen } = await loadEssenEinstellungen(trx);
    if (einstellungen.vorlageMahlzeiten.length) {
      await trx
        .insertInto('essen.mahlzeit')
        .values(
          einstellungen.vorlageMahlzeiten.map((name, position) => ({
            tag_id: tag.id,
            position: position + 1,
            name,
          }))
        )
        .execute();
    }
    return { result: undefined, details: { datum } };
  });
}

export async function tagVerschieben(
  zugang: Zugang,
  tagId: number,
  datum: string,
  etag: string
): Promise<void> {
  await aendere(zugang, 'tag-geaendert', async (trx) => {
    const tag = await tagDerPlanung(trx, zugang, tagId);
    const doppelt = await trx
      .selectFrom('essen.tag')
      .select('id')
      .where('planung_id', '=', zugang.planungId)
      .where('datum', '=', datum)
      .where('id', '<>', tagId)
      .executeTakeFirst();
    if (doppelt) throw TAG_GIBT_ES();
    const result = await trx
      .updateTable('essen.tag')
      .set({ datum })
      .where('id', '=', tagId)
      .where('version', '=', requireRowversion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    await pruefeAnwesenheit(trx, zugang.planungId);
    return { result: undefined, details: { datum, vorher: toDateString(tag.datum) } };
  });
}

export async function tagLoeschen(zugang: Zugang, tagId: number, etag: string): Promise<void> {
  await aendere(zugang, 'tag-geloescht', async (trx) => {
    const tag = await tagDerPlanung(trx, zugang, tagId);
    // `etag` is the `tagStand`: a meal or a planned dish changed meanwhile is a conflict
    const teile = await trx
      .selectFrom('essen.mahlzeit as m')
      .leftJoin('essen.einplanung as e', 'e.mahlzeit_id', 'm.id')
      .select(['m.id as mahlzeit_id', 'm.version as mahlzeit', 'e.version as einplanung'])
      .where('m.tag_id', '=', tagId)
      .execute();
    const stand = neuesteVersion([
      toVersion(tag.version),
      ...teile.flatMap((teil) => [
        toVersion(teil.mahlzeit),
        ...(teil.einplanung ? [toVersion(teil.einplanung)] : []),
      ]),
    ]);
    if (stand !== etag.trim()) throw new VersionConflictError();
    await verschiebeGrenzen(trx, zugang.planungId, [
      ...new Set(teile.map((teil) => teil.mahlzeit_id)),
    ]);
    const result = await trx
      .deleteFrom('essen.tag')
      .where('id', '=', tagId)
      .where('version', '=', tag.version)
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { datum: toDateString(tag.datum) } };
  });
}
