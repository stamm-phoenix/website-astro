import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  getSqlErrorNumber,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type { Zugang } from './essen-planung';
import { aendere } from './essen-planung';
import type {
  Ernaehrung,
  GruppeInput,
  PlanungGruppe,
  Teilnehmende,
  TeilnehmendeInput,
} from './essen-teilnehmende-model';
import { MAX_GRUPPEN, MAX_TEILNEHMENDE } from './essen-teilnehmende-model';
import { ValidationError } from './validation/errors';

/**
 * Groups and participants of a Planung and the groups that skip a meal
 * (`docs/essensplanung.md`, Teilnehmende). Every change runs in `aendere`, which locks the
 * Planung, so the checks here hold until the end.
 */

export interface TeilnehmendeDaten {
  gruppen: PlanungGruppe[];
  teilnehmende: Teilnehmende[];
  /** Per meal the groups that do not eat there. */
  ohneGruppen: Map<number, number[]>;
}

export async function ladeTeilnehmende(db: Db, planungId: number): Promise<TeilnehmendeDaten> {
  const [gruppen, zeilen, unvertraeglichkeiten, ohne] = await Promise.all([
    db.selectFrom('essen.planung_gruppe').selectAll().where('planung_id', '=', planungId).execute(),
    db.selectFrom('essen.teilnehmende').selectAll().where('planung_id', '=', planungId).execute(),
    db
      .selectFrom('essen.teilnehmende_unvertraeglichkeit as tu')
      .innerJoin('essen.teilnehmende as t', 't.id', 'tu.teilnehmende_id')
      .select(['tu.teilnehmende_id', 'tu.unvertraeglichkeit_id'])
      .where('t.planung_id', '=', planungId)
      .execute(),
    db
      .selectFrom('essen.mahlzeit_ohne_gruppe as mog')
      .innerJoin('essen.planung_gruppe as g', 'g.id', 'mog.gruppe_id')
      .select(['mog.mahlzeit_id', 'mog.gruppe_id'])
      .where('g.planung_id', '=', planungId)
      .execute(),
  ]);
  const jeZeile = new Map<number, number[]>();
  for (const row of unvertraeglichkeiten) {
    jeZeile.set(row.teilnehmende_id, [
      ...(jeZeile.get(row.teilnehmende_id) ?? []),
      row.unvertraeglichkeit_id,
    ]);
  }
  const ohneGruppen = new Map<number, number[]>();
  for (const row of ohne) {
    ohneGruppen.set(row.mahlzeit_id, [...(ohneGruppen.get(row.mahlzeit_id) ?? []), row.gruppe_id]);
  }
  const position = new Map(gruppen.map((gruppe) => [gruppe.id, gruppe.position]));
  const ERNAEHRUNG_REIHE: Record<Ernaehrung, number> = { alles: 0, vegetarisch: 1, vegan: 2 };
  return {
    gruppen: gruppen
      .map((gruppe): PlanungGruppe => ({
        id: gruppe.id,
        etag: toVersion(gruppe.version),
        position: gruppe.position,
        name: gruppe.name,
        faktor: Number(gruppe.faktor),
      }))
      .sort((a, b) => a.position - b.position || a.id - b.id),
    teilnehmende: zeilen
      .map((zeile): Teilnehmende => ({
        id: zeile.id,
        etag: toVersion(zeile.version),
        gruppeId: zeile.gruppe_id,
        ernaehrung: zeile.ernaehrung,
        anzahl: zeile.anzahl,
        unvertraeglichkeiten: (jeZeile.get(zeile.id) ?? []).sort((a, b) => a - b),
        vonMahlzeitId: zeile.von_mahlzeit_id,
        bisMahlzeitId: zeile.bis_mahlzeit_id,
        hinweis: zeile.hinweis,
      }))
      .sort(
        (a, b) =>
          (position.get(a.gruppeId) ?? 0) - (position.get(b.gruppeId) ?? 0) ||
          ERNAEHRUNG_REIHE[a.ernaehrung] - ERNAEHRUNG_REIHE[b.ernaehrung] ||
          a.id - b.id
      ),
    ohneGruppen,
  };
}

// ---------------------------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------------------------

const GIBT_ES = () => new ValidationError({ name: 'Diese Gruppe gibt es schon.' });

async function eindeutig<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    // Unique index on the name within the Planung
    if (getSqlErrorNumber(error) === 2627 || getSqlErrorNumber(error) === 2601) throw GIBT_ES();
    throw error;
  }
}

async function gruppeDerPlanung(trx: Db, zugang: Zugang, id: number) {
  const gruppe = await trx
    .selectFrom('essen.planung_gruppe')
    .select(['id', 'name'])
    .where('id', '=', id)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!gruppe) throw new RecordNotFoundError();
  return gruppe;
}

export async function gruppeAnlegen(zugang: Zugang, input: GruppeInput): Promise<void> {
  await aendere(zugang, 'gruppe-neu', async (trx) => {
    const gruppen = await trx
      .selectFrom('essen.planung_gruppe')
      .select(['name', 'position'])
      .where('planung_id', '=', zugang.planungId)
      .execute();
    if (gruppen.length >= MAX_GRUPPEN)
      throw new ValidationError({ name: `Höchstens ${MAX_GRUPPEN} Gruppen.` });
    await eindeutig(() =>
      trx
        .insertInto('essen.planung_gruppe')
        .values({
          planung_id: zugang.planungId,
          position: Math.max(0, ...gruppen.map((gruppe) => gruppe.position)) + 1,
          name: input.name,
          faktor: input.faktor,
        })
        .execute()
    );
    return { result: undefined, details: { name: input.name } };
  });
}

export async function gruppeAendern(
  zugang: Zugang,
  id: number,
  input: GruppeInput,
  etag: string
): Promise<void> {
  await aendere(zugang, 'gruppe-geaendert', async (trx) => {
    const gruppe = await gruppeDerPlanung(trx, zugang, id);
    const result = await eindeutig(() =>
      trx
        .updateTable('essen.planung_gruppe')
        .set({ name: input.name, faktor: input.faktor })
        .where('id', '=', id)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst()
    );
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    return {
      result: undefined,
      details: { name: input.name, ...(gruppe.name !== input.name ? { vorher: gruppe.name } : {}) },
    };
  });
}

/** Deletes a group without participants; the meals it skipped forget it. */
export async function gruppeLoeschen(zugang: Zugang, id: number, etag: string): Promise<void> {
  await aendere(zugang, 'gruppe-geloescht', async (trx) => {
    const gruppe = await gruppeDerPlanung(trx, zugang, id);
    const genutzt = await trx
      .selectFrom('essen.teilnehmende')
      .select('id')
      .where('gruppe_id', '=', id)
      .top(1)
      .executeTakeFirst();
    if (genutzt)
      throw new ValidationError({
        name: 'Die Gruppe hat noch Teilnehmende. Entferne oder verschiebe sie zuerst.',
      });
    await trx.deleteFrom('essen.mahlzeit_ohne_gruppe').where('gruppe_id', '=', id).execute();
    const result = await trx
      .deleteFrom('essen.planung_gruppe')
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { name: gruppe.name } };
  });
}

// ---------------------------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------------------------

/**
 * Checks group, limits and intolerances. A limit kept from before (`bisher`) may point to a meal
 * that is gone, as `verschiebeGrenzen` leaves it, so the row can still be changed otherwise.
 */
async function pruefeVerweise(
  trx: Db,
  zugang: Zugang,
  input: TeilnehmendeInput,
  bisher?: { von: number | null; bis: number | null }
) {
  const gruppe = await trx
    .selectFrom('essen.planung_gruppe')
    .select('name')
    .where('id', '=', input.gruppeId)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!gruppe) throw new ValidationError({ gruppeId: 'Bitte eine Gruppe wählen.' });
  const grenzen = [input.vonMahlzeitId, input.bisMahlzeitId].filter((id) => id !== null);
  if (grenzen.length) {
    const gefunden = await trx
      .selectFrom('essen.mahlzeit as m')
      .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
      .select(['m.id', 't.datum', 'm.position'])
      .where('m.id', 'in', grenzen)
      .where('t.planung_id', '=', zugang.planungId)
      .execute();
    const ort = (id: number | null) => gefunden.find((row) => row.id === id);
    const von = ort(input.vonMahlzeitId);
    const bis = ort(input.bisMahlzeitId);
    if (input.vonMahlzeitId !== null && !von && input.vonMahlzeitId !== bisher?.von)
      throw new ValidationError({ vonMahlzeitId: 'Diese Mahlzeit gibt es nicht mehr.' });
    if (input.bisMahlzeitId !== null && !bis && input.bisMahlzeitId !== bisher?.bis)
      throw new ValidationError({ bisMahlzeitId: 'Diese Mahlzeit gibt es nicht mehr.' });
    if (von && bis) {
      const reihe = (row: typeof von) =>
        `${toDateString(row.datum)}-${String(row.position).padStart(4, '0')}`;
      if (reihe(von) > reihe(bis))
        throw new ValidationError({ bisMahlzeitId: 'Bis liegt vor Von.' });
    }
  }
  if (input.unvertraeglichkeiten.length) {
    const gefunden = await trx
      .selectFrom('essen.unvertraeglichkeit')
      .select('id')
      .where('id', 'in', input.unvertraeglichkeiten)
      .execute();
    if (gefunden.length !== input.unvertraeglichkeiten.length)
      throw new ValidationError({ unvertraeglichkeiten: 'Bitte aus der Liste wählen.' });
  }
  return gruppe.name;
}

function werte(input: TeilnehmendeInput) {
  return {
    gruppe_id: input.gruppeId,
    ernaehrung: input.ernaehrung,
    anzahl: input.anzahl,
    von_mahlzeit_id: input.vonMahlzeitId,
    bis_mahlzeit_id: input.bisMahlzeitId,
    hinweis: input.hinweis,
  };
}

async function setzeUnvertraeglichkeiten(trx: Db, id: number, ids: number[]): Promise<void> {
  await trx
    .deleteFrom('essen.teilnehmende_unvertraeglichkeit')
    .where('teilnehmende_id', '=', id)
    .execute();
  if (ids.length) {
    await trx
      .insertInto('essen.teilnehmende_unvertraeglichkeit')
      .values(
        ids.map((unvertraeglichkeitId) => ({
          teilnehmende_id: id,
          unvertraeglichkeit_id: unvertraeglichkeitId,
        }))
      )
      .execute();
  }
}

export async function teilnehmendeAnlegen(zugang: Zugang, input: TeilnehmendeInput): Promise<void> {
  await aendere(zugang, 'teilnehmende-neu', async (trx) => {
    const gruppe = await pruefeVerweise(trx, zugang, input);
    const anzahl = await trx
      .selectFrom('essen.teilnehmende')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('planung_id', '=', zugang.planungId)
      .executeTakeFirstOrThrow();
    if (Number(anzahl.count) >= MAX_TEILNEHMENDE)
      throw new ValidationError({ anzahl: `Höchstens ${MAX_TEILNEHMENDE} Zeilen.` });
    const neu = await trx
      .insertInto('essen.teilnehmende')
      .values({ planung_id: zugang.planungId, ...werte(input) })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    await setzeUnvertraeglichkeiten(trx, neu.id, input.unvertraeglichkeiten);
    return { result: undefined, details: { name: gruppe, anzahl: input.anzahl } };
  });
}

async function teilnehmendeDerPlanung(trx: Db, zugang: Zugang, id: number) {
  const zeile = await trx
    .selectFrom('essen.teilnehmende')
    .select(['id', 'von_mahlzeit_id', 'bis_mahlzeit_id'])
    .where('id', '=', id)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!zeile) throw new RecordNotFoundError();
  return zeile;
}

export async function teilnehmendeAendern(
  zugang: Zugang,
  id: number,
  input: TeilnehmendeInput,
  etag: string
): Promise<void> {
  await aendere(zugang, 'teilnehmende-geaendert', async (trx) => {
    const bisher = await teilnehmendeDerPlanung(trx, zugang, id);
    const gruppe = await pruefeVerweise(trx, zugang, input, {
      von: bisher.von_mahlzeit_id,
      bis: bisher.bis_mahlzeit_id,
    });
    const result = await trx
      .updateTable('essen.teilnehmende')
      .set(werte(input))
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    await setzeUnvertraeglichkeiten(trx, id, input.unvertraeglichkeiten);
    return { result: undefined, details: { name: gruppe, anzahl: input.anzahl } };
  });
}

export async function teilnehmendeLoeschen(
  zugang: Zugang,
  id: number,
  etag: string
): Promise<void> {
  await aendere(zugang, 'teilnehmende-geloescht', async (trx) => {
    await teilnehmendeDerPlanung(trx, zugang, id);
    const zeile = await trx
      .selectFrom('essen.teilnehmende as t')
      .innerJoin('essen.planung_gruppe as g', 'g.id', 't.gruppe_id')
      .select(['g.name', 't.anzahl'])
      .where('t.id', '=', id)
      .executeTakeFirstOrThrow();
    const result = await trx
      .deleteFrom('essen.teilnehmende')
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { name: zeile.name, anzahl: zeile.anzahl } };
  });
}

// ---------------------------------------------------------------------------------------------
// Groups at a meal
// ---------------------------------------------------------------------------------------------

/** Lets a group eat at a meal or not; setting it twice changes nothing. */
export async function mahlzeitGruppeSetzen(
  zugang: Zugang,
  mahlzeitId: number,
  gruppeId: number,
  isst: boolean
): Promise<void> {
  await aendere(zugang, 'mahlzeit-gruppen', async (trx) => {
    const mahlzeit = await trx
      .selectFrom('essen.mahlzeit as m')
      .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
      .select(['m.name', 't.datum'])
      .where('m.id', '=', mahlzeitId)
      .where('t.planung_id', '=', zugang.planungId)
      .executeTakeFirst();
    if (!mahlzeit) throw new RecordNotFoundError();
    const gruppe = await gruppeDerPlanung(trx, zugang, gruppeId);
    const geloescht = await trx
      .deleteFrom('essen.mahlzeit_ohne_gruppe')
      .where('mahlzeit_id', '=', mahlzeitId)
      .where('gruppe_id', '=', gruppeId)
      .executeTakeFirst();
    if (!isst) {
      await trx
        .insertInto('essen.mahlzeit_ohne_gruppe')
        .values({ mahlzeit_id: mahlzeitId, gruppe_id: gruppeId })
        .execute();
    }
    // A real change gives the meal a new version, so deleting it with the old one is a conflict
    if (isst === Number(geloescht.numDeletedRows) > 0) {
      await trx
        .updateTable('essen.mahlzeit')
        .set((eb) => ({ name: eb.ref('name') }))
        .where('id', '=', mahlzeitId)
        .execute();
    }
    return {
      result: undefined,
      details: {
        name: mahlzeit.name,
        datum: toDateString(mahlzeit.datum),
        gruppe: gruppe.name,
        isst,
      },
    };
  });
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
  const reihe = (
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
    await trx
      .updateTable('essen.teilnehmende')
      .set({ von_mahlzeit_id: von, bis_mahlzeit_id: bis })
      .where('id', '=', zeile.id)
      .execute();
  }
}
