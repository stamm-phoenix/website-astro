import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import type { Database } from './db-schema';
import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  lockResource,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type {
  Einkauf,
  EinkaufHaken,
  EinkaufInput,
  EinkaufRegel,
  HakenInput,
  RegelInput,
  VerschiebenInput,
  ZurueckholenInput,
} from './essen-einkaeufe-model';
import { MAX_EINKAEUFE, MAX_EINKAUF_EINTRAEGE, einkaufStand } from './essen-einkaeufe-model';
import { EINHEITEN_JE_ART, einheitPasst, zutatSperre } from './essen-gerichte-model';
import type { GerichtEinheit } from './essen-gerichte-model';
import type { Zugang } from './essen-planung';
import { aendere } from './essen-planung';
import { zutatDerPlanung } from './essen-planung-zutat';
import { ValidationError } from './validation/errors';

/**
 * Shopping trips of a Planung (`docs/essensplanung.md`, Einkäufe): the trips, what is ticked off
 * while shopping and the rules set by hand. Every change runs in `aendere`, which locks the
 * Planung, so the checks here hold until the end. Their lists are worked out by the page.
 */

export async function ladeEinkaeufe(db: Db, planungId: number): Promise<Einkauf[]> {
  const [einkaeufe, posten, regeln] = await Promise.all([
    db.selectFrom('essen.einkauf').selectAll().where('planung_id', '=', planungId).execute(),
    db
      .selectFrom('essen.einkauf_posten as p')
      .innerJoin('essen.einkauf as e', 'e.id', 'p.einkauf_id')
      .leftJoin('essen.mitglied as m', 'm.id', 'p.abgehakt_von_mitglied_id')
      .selectAll('p')
      .select('m.name as von')
      .where('e.planung_id', '=', planungId)
      .orderBy('p.id')
      .execute(),
    db
      .selectFrom('essen.einkauf_regel as r')
      .innerJoin('essen.einkauf as e', 'e.id', 'r.einkauf_id')
      .selectAll('r')
      .where('e.planung_id', '=', planungId)
      .orderBy('r.id')
      .execute(),
  ]);
  const postenJe = new Map<number, EinkaufHaken[]>();
  for (const row of posten) {
    const liste = postenJe.get(row.einkauf_id) ?? [];
    liste.push({
      id: row.id,
      etag: toVersion(row.version),
      planungZutatId: row.planung_zutat_id,
      einheit: row.einheit,
      erhalten: Number(row.erhalten),
      ersatz: row.ersatz,
      von: row.von ?? '',
      am: row.abgehakt_am.toISOString(),
    });
    postenJe.set(row.einkauf_id, liste);
  }
  const regelnJe = new Map<number, EinkaufRegel[]>();
  for (const row of regeln) {
    const liste = regelnJe.get(row.einkauf_id) ?? [];
    liste.push({
      planungZutatId: row.planung_zutat_id,
      art: row.art,
      menge: row.menge === null ? null : Number(row.menge),
      einheit: row.einheit,
    });
    regelnJe.set(row.einkauf_id, liste);
  }
  return einkaeufe
    .map((row) => ({
      id: row.id,
      etag: toVersion(row.version),
      position: row.position,
      name: row.name,
      datum: row.datum === null ? null : toDateString(row.datum),
      geschaeftId: row.geschaeft_id,
      bisMahlzeitId: row.bis_mahlzeit_id,
      abgeschlossen: Boolean(row.abgeschlossen),
      posten: postenJe.get(row.id) ?? [],
      regeln: regelnJe.get(row.id) ?? [],
    }))
    .sort((a, b) => a.position - b.position || a.id - b.id);
}

async function einkaufDerPlanung(trx: Db, zugang: Zugang, id: number) {
  const einkauf = await trx
    .selectFrom('essen.einkauf')
    .select(['id', 'version', 'name'])
    .where('id', '=', id)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!einkauf) throw new RecordNotFoundError();
  return einkauf;
}

/** The shop and the meal a trip names must be of this Planung. */
async function pruefeBezug(trx: Db, zugang: Zugang, input: EinkaufInput): Promise<void> {
  if (input.geschaeftId !== null) {
    const geschaeft = await trx
      .selectFrom('essen.geschaeft')
      .select('id')
      .where('id', '=', input.geschaeftId)
      .where('planung_id', '=', zugang.planungId)
      .executeTakeFirst();
    if (!geschaeft)
      throw new ValidationError({ geschaeftId: 'Dieses Geschäft gibt es nicht mehr.' });
  }
  if (input.bisMahlzeitId !== null) {
    const mahlzeit = await trx
      .selectFrom('essen.mahlzeit as m')
      .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
      .select('m.id')
      .where('m.id', '=', input.bisMahlzeitId)
      .where('t.planung_id', '=', zugang.planungId)
      .executeTakeFirst();
    if (!mahlzeit)
      throw new ValidationError({ bisMahlzeitId: 'Diese Mahlzeit gibt es nicht mehr.' });
  }
}

function werte(input: EinkaufInput) {
  return {
    name: input.name,
    datum: input.datum,
    geschaeft_id: input.geschaeftId,
    bis_mahlzeit_id: input.bisMahlzeitId,
    abgeschlossen: input.abgeschlossen,
  };
}

export async function einkaufAnlegen(zugang: Zugang, input: EinkaufInput): Promise<void> {
  await aendere(zugang, 'einkauf-neu', async (trx) => {
    const einkaeufe = await trx
      .selectFrom('essen.einkauf')
      .select('position')
      .where('planung_id', '=', zugang.planungId)
      .execute();
    if (einkaeufe.length >= MAX_EINKAEUFE)
      throw new ValidationError({ name: `Höchstens ${MAX_EINKAEUFE} Einkäufe.` });
    await pruefeBezug(trx, zugang, input);
    await trx
      .insertInto('essen.einkauf')
      .values({
        planung_id: zugang.planungId,
        position: Math.max(0, ...einkaeufe.map((e) => e.position)) + 1,
        ...werte(input),
      })
      .execute();
    return { result: undefined, details: { name: input.name } };
  });
}

/** Changes a trip on the version it was seen in; finishing it is a change like any other. */
export async function einkaufAendern(
  zugang: Zugang,
  id: number,
  input: EinkaufInput,
  etag: string
): Promise<void> {
  await aendere(zugang, 'einkauf-geaendert', async (trx) => {
    await einkaufDerPlanung(trx, zugang, id);
    const vorher = await trx
      .selectFrom('essen.einkauf')
      .select('abgeschlossen')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    await pruefeBezug(trx, zugang, input);
    const result = await trx
      .updateTable('essen.einkauf')
      .set(werte(input))
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    return {
      result: undefined,
      details: {
        name: input.name,
        ...(Boolean(vorher.abgeschlossen) !== input.abgeschlossen
          ? { abgeschlossen: input.abgeschlossen }
          : {}),
      },
    };
  });
}

/**
 * Deletes a trip with what was ticked off on it; `etag` is its `einkaufStand`, so something
 * ticked off meanwhile is a conflict. What was bought on it leaves the stock.
 */
export async function einkaufLoeschen(zugang: Zugang, id: number, etag: string): Promise<void> {
  await aendere(zugang, 'einkauf-geloescht', async (trx) => {
    const einkauf = await einkaufDerPlanung(trx, zugang, id);
    const posten = await trx
      .selectFrom('essen.einkauf_posten')
      .select('version')
      .where('einkauf_id', '=', id)
      .execute();
    const stand = einkaufStand({
      etag: toVersion(einkauf.version),
      posten: posten.map((p) => ({ etag: toVersion(p.version) })),
    });
    if (stand !== etag.trim()) throw new VersionConflictError();
    const result = await trx
      .deleteFrom('essen.einkauf')
      .where('id', '=', id)
      .where('version', '=', einkauf.version)
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { name: einkauf.name } };
  });
}

/** The units that are summed together: g with kg, ml with l, the counted ones alone. */
function gleicheArt(a: GerichtEinheit, b: GerichtEinheit): boolean {
  return Object.values(EINHEITEN_JE_ART).some((liste) => liste.includes(a) && liste.includes(b));
}

/** The ingredient of the Planung, in a unit that fits it. */
async function zutatMitEinheit(
  trx: Transaction<Database>,
  zugang: Zugang,
  planungZutatId: number,
  einheit: GerichtEinheit | null,
  feld: string
) {
  const lesen = () =>
    zutatDerPlanung(trx, zugang, planungZutatId).catch(() => {
      throw new ValidationError({
        planungZutatId: 'Diese Zutat gibt es nicht mehr. Bitte lade die Seite neu.',
      });
    });
  let zutat = await lesen();
  // The kind of unit inherited from the central list: the Steuerung changes it only under this
  // lock, so it is read again once the lock is held
  if (zutat.zutat_id !== null && zutat.einheitenart === null) {
    await lockResource(trx, zutatSperre(zutat.zutat_id));
    zutat = await lesen();
  }
  const art = zutat.einheitenart ?? zutat.z_einheitenart;
  const name = zutat.name ?? zutat.z_name ?? 'Die Zutat';
  if (!art || !einheitPasst(art, einheit))
    throw new ValidationError({ [feld]: `${name} wird in einer anderen Einheit gemessen.` });
  return { name };
}

/**
 * Ticks off a thing on a trip with what was bought, or changes what was ticked off. `etag` is
 * the version of the thing ticked off before (in the same kind of unit), null for none: when
 * someone else ticked it off meanwhile, or took it back, it is a conflict.
 */
export async function postenAbhaken(
  zugang: Zugang,
  einkaufId: number,
  input: HakenInput,
  etag: string | null
): Promise<void> {
  await aendere(zugang, 'einkauf-abgehakt', async (trx, aktuell) => {
    const einkauf = await einkaufDerPlanung(trx, zugang, einkaufId);
    const { name } = await zutatMitEinheit(
      trx,
      zugang,
      input.planungZutatId,
      input.einheit,
      'einheit'
    );
    const vorhanden = (
      await trx
        .selectFrom('essen.einkauf_posten')
        .select(['id', 'version', 'einheit'])
        .where('einkauf_id', '=', einkaufId)
        .where('planung_zutat_id', '=', input.planungZutatId)
        .execute()
    ).filter((row) => gleicheArt(row.einheit, input.einheit));
    const werte = {
      einheit: input.einheit,
      erhalten: input.erhalten,
      ersatz: input.ersatz,
      abgehakt_von_mitglied_id: aktuell.mitgliedId,
    };
    if (etag === null) {
      if (vorhanden.length) throw new VersionConflictError();
      const anzahl = await trx
        .selectFrom('essen.einkauf_posten')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('einkauf_id', '=', einkaufId)
        .executeTakeFirstOrThrow();
      if (Number(anzahl.count) >= MAX_EINKAUF_EINTRAEGE)
        throw new ValidationError({ planungZutatId: 'Dieser Einkauf ist voll.' });
      await trx
        .insertInto('essen.einkauf_posten')
        .values({ einkauf_id: einkaufId, planung_zutat_id: input.planungZutatId, ...werte })
        .execute();
    } else {
      const zeile = vorhanden.find((row) => toVersion(row.version) === etag.trim());
      if (!zeile) throw new VersionConflictError();
      const result = await trx
        .updateTable('essen.einkauf_posten')
        .set({ ...werte, abgehakt_am: sql<Date>`SYSUTCDATETIME()` })
        .where('id', '=', zeile.id)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    }
    return {
      result: undefined,
      details: { name, einkauf: einkauf.name, ...(input.ersatz ? { ersatz: input.ersatz } : {}) },
    };
  });
}

/** Takes back a thing ticked off: it is open again on its trip. */
export async function postenAufheben(zugang: Zugang, id: number, etag: string): Promise<void> {
  await aendere(zugang, 'einkauf-aufgehoben', async (trx) => {
    const posten = await trx
      .selectFrom('essen.einkauf_posten as p')
      .innerJoin('essen.einkauf as e', 'e.id', 'p.einkauf_id')
      .select(['p.id', 'p.planung_zutat_id', 'e.name as einkauf'])
      .where('p.id', '=', id)
      .where('e.planung_id', '=', zugang.planungId)
      .executeTakeFirst();
    if (!posten) throw new RecordNotFoundError();
    const zutat = await zutatDerPlanung(trx, zugang, posten.planung_zutat_id);
    const result = await trx
      .deleteFrom('essen.einkauf_posten')
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return {
      result: undefined,
      details: { name: zutat.name ?? zutat.z_name, einkauf: posten.einkauf },
    };
  });
}

/** Sets or replaces the rule of one ingredient on one trip, inside a running change. */
async function schreibeRegel(trx: Db, einkaufId: number, input: RegelInput): Promise<void> {
  await trx
    .deleteFrom('essen.einkauf_regel')
    .where('einkauf_id', '=', einkaufId)
    .where('planung_zutat_id', '=', input.planungZutatId)
    .execute();
  if (input.art === null) return;
  const anzahl = await trx
    .selectFrom('essen.einkauf_regel')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('einkauf_id', '=', einkaufId)
    .executeTakeFirstOrThrow();
  if (Number(anzahl.count) >= MAX_EINKAUF_EINTRAEGE)
    throw new ValidationError({ planungZutatId: 'Dieser Einkauf hat zu viele Regeln.' });
  await trx
    .insertInto('essen.einkauf_regel')
    .values({
      einkauf_id: einkaufId,
      planung_zutat_id: input.planungZutatId,
      art: input.art,
      menge: input.menge,
      einheit: input.einheit,
    })
    .execute();
}

/**
 * Sets the rule of an ingredient on a trip: not on it, on it although of another shop, or a
 * fixed amount; null takes the rule away. The latest choice counts.
 */
export async function regelSetzen(
  zugang: Zugang,
  einkaufId: number,
  input: RegelInput
): Promise<void> {
  await aendere(zugang, 'einkauf-regel', async (trx) => {
    const einkauf = await einkaufDerPlanung(trx, zugang, einkaufId);
    const { name } = await zutatMitEinheit(
      trx,
      zugang,
      input.planungZutatId,
      input.einheit,
      'einheit'
    );
    await schreibeRegel(trx, einkaufId, input);
    return {
      result: undefined,
      details: { name, einkauf: einkauf.name, regel: input.art },
    };
  });
}

/** Moves an ingredient from one trip to another in one change: not on that one, on this one. */
export async function verschieben(
  zugang: Zugang,
  vonEinkaufId: number,
  input: VerschiebenInput
): Promise<void> {
  await aendere(zugang, 'einkauf-verschoben', async (trx) => {
    const von = await einkaufDerPlanung(trx, zugang, vonEinkaufId);
    if (input.nachEinkaufId === vonEinkaufId)
      throw new ValidationError({ nachEinkaufId: 'Bitte einen anderen Einkauf wählen.' });
    const nach = await einkaufDerPlanung(trx, zugang, input.nachEinkaufId).catch(() => {
      throw new ValidationError({ nachEinkaufId: 'Diesen Einkauf gibt es nicht mehr.' });
    });
    const { name } = await zutatMitEinheit(trx, zugang, input.planungZutatId, null, 'einheit');
    const regel = { planungZutatId: input.planungZutatId, menge: null, einheit: null };
    await schreibeRegel(trx, vonEinkaufId, { ...regel, art: 'ohne' });
    await schreibeRegel(trx, input.nachEinkaufId, { ...regel, art: 'mit' });
    return {
      result: undefined,
      details: { name, einkauf: von.name, nach: nach.name },
    };
  });
}

/**
 * Takes back „not on this trip“ in one change: the rule here goes, and so does the „mit“ of the
 * trip it was moved to, so both work it out again. Nothing changes when it is not taken off here.
 */
export async function zurueckholen(
  zugang: Zugang,
  einkaufId: number,
  input: ZurueckholenInput
): Promise<void> {
  await aendere(zugang, 'einkauf-zurueckgeholt', async (trx) => {
    const einkauf = await einkaufDerPlanung(trx, zugang, einkaufId);
    const { name } = await zutatMitEinheit(trx, zugang, input.planungZutatId, null, 'einheit');
    const regel = await trx
      .selectFrom('essen.einkauf_regel')
      .select('id')
      .where('einkauf_id', '=', einkaufId)
      .where('planung_zutat_id', '=', input.planungZutatId)
      .where('art', '=', 'ohne')
      .executeTakeFirst();
    if (!regel)
      throw new ValidationError({
        planungZutatId: `${name} ist in diesem Einkauf nicht herausgenommen.`,
      });
    await trx.deleteFrom('essen.einkauf_regel').where('id', '=', regel.id).execute();
    await trx
      .deleteFrom('essen.einkauf_regel')
      .where('planung_zutat_id', '=', input.planungZutatId)
      .where('art', '=', 'mit')
      .where('einkauf_id', 'in', (eb) =>
        eb.selectFrom('essen.einkauf').select('id').where('planung_id', '=', zugang.planungId)
      )
      .execute();
    return { result: undefined, details: { name, einkauf: einkauf.name } };
  });
}
