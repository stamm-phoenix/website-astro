import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type { Zugang } from './essen-planung';
import { aendere } from './essen-planung';
import type { Einplanung, EinplanungInput } from './essen-planung-model';
import { MAX_EINPLANUNGEN_PRO_MAHLZEIT } from './essen-planung-model';
import type { Verbrauch } from './essen-kochen-model';
import { ValidationError } from './validation/errors';

/**
 * Dishes planned at the meals of a Planung (`docs/essensplanung.md`, Einplanung). Every change
 * runs in `aendere`, which locks the Planung, so the checks here hold until the end.
 */

/** What the cooked dishes of a Planung used, by planned dish. */
export async function ladeVerbrauch(db: Db, planungId: number): Promise<Map<number, Verbrauch[]>> {
  const rows = await db
    .selectFrom('essen.einplanung_verbrauch as v')
    .innerJoin('essen.einplanung as e', 'e.id', 'v.einplanung_id')
    .innerJoin('essen.gericht as g', 'g.id', 'e.gericht_id')
    .select(['v.einplanung_id', 'v.planung_zutat_id', 'v.menge', 'v.einheit'])
    .where('g.planung_id', '=', planungId)
    .orderBy('v.id')
    .execute();
  const jeEinplanung = new Map<number, Verbrauch[]>();
  for (const row of rows) {
    const liste = jeEinplanung.get(row.einplanung_id) ?? [];
    liste.push({
      planungZutatId: row.planung_zutat_id,
      menge: Number(row.menge),
      einheit: row.einheit,
    });
    jeEinplanung.set(row.einplanung_id, liste);
  }
  return jeEinplanung;
}

/** The planned dishes of a Planung by meal, in their order. */
export async function ladeEinplanungen(
  db: Db,
  planungId: number
): Promise<Map<number, Einplanung[]>> {
  const rows = await db
    .selectFrom('essen.einplanung as e')
    .innerJoin('essen.gericht as g', 'g.id', 'e.gericht_id')
    .leftJoin('essen.mitglied as m', 'm.id', 'e.zustaendig_mitglied_id')
    .select([
      'e.id',
      'e.version',
      'e.mahlzeit_id',
      'e.gericht_id',
      'e.position',
      'e.faktor',
      'e.zustaendig_mitglied_id',
      'e.zustaendig_text',
      'e.status',
      'm.name as mitglied_name',
    ])
    .where('g.planung_id', '=', planungId)
    .execute();
  // Read after the versions: a save in between leaves an old version with new amounts, which a
  // save on it refuses, never new versions with old amounts
  const verbrauch = await ladeVerbrauch(db, planungId);
  const jeMahlzeit = new Map<number, Einplanung[]>();
  for (const row of rows) {
    const liste = jeMahlzeit.get(row.mahlzeit_id) ?? [];
    liste.push({
      id: row.id,
      etag: toVersion(row.version),
      gerichtId: row.gericht_id,
      position: row.position,
      faktor: Number(row.faktor),
      zustaendigId: row.zustaendig_mitglied_id,
      zustaendig: row.mitglied_name ?? row.zustaendig_text,
      status: row.status,
      verbrauch: verbrauch.get(row.id) ?? [],
    });
    jeMahlzeit.set(row.mahlzeit_id, liste);
  }
  return jeMahlzeit;
}

export async function mahlzeitDerPlanung(trx: Db, zugang: Zugang, mahlzeitId: number) {
  const mahlzeit = await trx
    .selectFrom('essen.mahlzeit as m')
    .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
    .select(['m.id', 'm.name', 't.datum'])
    .where('m.id', '=', mahlzeitId)
    .where('t.planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!mahlzeit) throw new ValidationError({ mahlzeitId: 'Diese Mahlzeit gibt es nicht mehr.' });
  return mahlzeit;
}

async function gerichtName(trx: Db, zugang: Zugang, gerichtId: number): Promise<string> {
  const gericht = await trx
    .selectFrom('essen.gericht')
    .select('name')
    .where('id', '=', gerichtId)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!gericht) throw new ValidationError({ gerichtId: 'Dieses Gericht gibt es nicht mehr.' });
  return gericht.name;
}

/**
 * Who is responsible: a member of this Planung who still has access, or a free name. One who
 * is `bisher` responsible stays allowed after losing access, so the dish can still be changed.
 */
async function pruefeZustaendig(
  trx: Db,
  zugang: Zugang,
  input: EinplanungInput,
  bisher: number | null = null
): Promise<void> {
  if (input.zustaendigId === null || input.zustaendigId === bisher) return;
  const mitglied = await trx
    .selectFrom('essen.mitglied')
    .select('id')
    .where('id', '=', input.zustaendigId)
    .where('planung_id', '=', zugang.planungId)
    .where('entzogen_am', 'is', null)
    .executeTakeFirst();
  if (!mitglied) throw new ValidationError({ zustaendigId: 'Bitte aus der Liste wählen.' });
}

async function pruefePlatz(trx: Db, mahlzeitId: number): Promise<void> {
  const anzahl = await trx
    .selectFrom('essen.einplanung')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('mahlzeit_id', '=', mahlzeitId)
    .executeTakeFirstOrThrow();
  if (Number(anzahl.count) >= MAX_EINPLANUNGEN_PRO_MAHLZEIT) {
    throw new ValidationError({
      mahlzeitId: `Höchstens ${MAX_EINPLANUNGEN_PRO_MAHLZEIT} Gerichte pro Mahlzeit.`,
    });
  }
}

/** Moves `einplanungId` to `position` in its meal; without both it only closes gaps. */
export async function sortiere(
  trx: Db,
  mahlzeitId: number,
  einplanungId: number | null,
  position?: number
): Promise<void> {
  const rows = await trx
    .selectFrom('essen.einplanung')
    .select(['id', 'position'])
    .where('mahlzeit_id', '=', mahlzeitId)
    .orderBy('position')
    .orderBy('id')
    .execute();
  const ids = rows.map((row) => row.id).filter((id) => id !== einplanungId);
  if (einplanungId !== null) {
    const ziel = Math.min(Math.max((position ?? ids.length + 1) - 1, 0), ids.length);
    ids.splice(ziel, 0, einplanungId);
  }
  for (const [index, id] of ids.entries()) {
    if (rows.find((row) => row.id === id)?.position !== index + 1) {
      await trx
        .updateTable('essen.einplanung')
        .set({ position: index + 1 })
        .where('id', '=', id)
        .execute();
    }
  }
}

function werte(input: EinplanungInput) {
  return {
    faktor: input.faktor,
    zustaendig_mitglied_id: input.zustaendigId,
    zustaendig_text: input.zustaendigId === null ? input.zustaendigText : '',
  };
}

/** Plans a dish at a meal, at the end or at `position`; also how a planned dish is copied. */
export async function einplanen(
  zugang: Zugang,
  input: EinplanungInput,
  position?: number
): Promise<void> {
  await aendere(zugang, 'einplanung-neu', async (trx) => {
    const mahlzeit = await mahlzeitDerPlanung(trx, zugang, input.mahlzeitId);
    const name = await gerichtName(trx, zugang, input.gerichtId);
    await pruefeZustaendig(trx, zugang, input);
    await pruefePlatz(trx, mahlzeit.id);
    const neu = await trx
      .insertInto('essen.einplanung')
      .values({
        mahlzeit_id: mahlzeit.id,
        gericht_id: input.gerichtId,
        position: 32_000,
        ...werte(input),
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    await sortiere(trx, mahlzeit.id, neu.id, position);
    return {
      result: undefined,
      details: { name, mahlzeit: mahlzeit.name, datum: toDateString(mahlzeit.datum) },
    };
  });
}

export async function einplanungDerPlanung(trx: Db, zugang: Zugang, id: number) {
  const einplanung = await trx
    .selectFrom('essen.einplanung as e')
    .innerJoin('essen.gericht as g', 'g.id', 'e.gericht_id')
    .select(['e.id', 'e.mahlzeit_id', 'e.gericht_id', 'e.zustaendig_mitglied_id', 'g.name'])
    .where('e.id', '=', id)
    .where('g.planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!einplanung) throw new RecordNotFoundError();
  return einplanung;
}

/**
 * Changes factor and who is responsible, and moves the dish to `input.mahlzeitId` (at the end
 * or at `position`). The dish itself stays; another one is planned anew.
 */
export async function einplanungAendern(
  zugang: Zugang,
  id: number,
  input: EinplanungInput,
  etag: string,
  position?: number
): Promise<void> {
  await aendere(zugang, 'einplanung-geaendert', async (trx) => {
    const einplanung = await einplanungDerPlanung(trx, zugang, id);
    const mahlzeit = await mahlzeitDerPlanung(trx, zugang, input.mahlzeitId);
    await pruefeZustaendig(trx, zugang, input, einplanung.zustaendig_mitglied_id);
    const verschoben = mahlzeit.id !== einplanung.mahlzeit_id;
    if (verschoben) await pruefePlatz(trx, mahlzeit.id);
    const result = await trx
      .updateTable('essen.einplanung')
      .set({ ...werte(input), mahlzeit_id: mahlzeit.id })
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    if (verschoben) {
      await sortiere(trx, einplanung.mahlzeit_id, null);
      await sortiere(trx, mahlzeit.id, id, position);
    } else if (position !== undefined) {
      await sortiere(trx, mahlzeit.id, id, position);
    }
    return {
      result: undefined,
      details: {
        name: einplanung.name,
        mahlzeit: mahlzeit.name,
        datum: toDateString(mahlzeit.datum),
        ...(verschoben ? { verschoben: true } : {}),
      },
    };
  });
}

/** Takes a dish off a meal; the dish itself stays. */
export async function einplanungLoeschen(zugang: Zugang, id: number, etag: string): Promise<void> {
  await aendere(zugang, 'einplanung-geloescht', async (trx) => {
    const einplanung = await einplanungDerPlanung(trx, zugang, id);
    const mahlzeit = await mahlzeitDerPlanung(trx, zugang, einplanung.mahlzeit_id);
    const result = await trx
      .deleteFrom('essen.einplanung')
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    await sortiere(trx, einplanung.mahlzeit_id, null);
    return {
      result: undefined,
      details: {
        name: einplanung.name,
        mahlzeit: mahlzeit.name,
        datum: toDateString(mahlzeit.datum),
      },
    };
  });
}
