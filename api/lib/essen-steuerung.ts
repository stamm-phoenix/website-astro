import { sql } from 'kysely';
import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  getSqlErrorNumber,
  inTransaction,
  parseId,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type {
  EssenAuditEntry,
  EssenEinstellungen,
  EssenKategorie,
  EssenPlanungUebersicht,
  EssenSteuerungView,
  EssenUnvertraeglichkeit,
  EssenZutat,
  StoredEssenEinstellungen,
  ZutatInput,
} from './essen-validation';
import { COLLATOR, readGruppen, readStrings } from './essen-validation';
import { deletePlanung } from './essen-planung-loeschen';
import { loeschDatum } from './essen-planung-model';
import type { FieldErrors } from './validation/errors';
import { ValidationError } from './validation/errors';

/**
 * The Steuerung of the Essensplanung (`docs/essensplanung.md`): switches, templates for new
 * Planungen and the central lists of ingredients, categories and allergens. Only the teams
 * Admin and Vorstand change them; every change is logged in `essen.audit_log`.
 */

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

export async function loadEssenEinstellungen(db: Db = getDb()): Promise<StoredEssenEinstellungen> {
  const row = await db
    .selectFrom('essen.einstellungen')
    .selectAll()
    .where('id', '=', 1)
    .executeTakeFirstOrThrow();
  return {
    einstellungen: {
      anlegenExtern: row.anlegen_extern,
      whitelist: readStrings(row.whitelist),
      aufbewahrungMonate: row.aufbewahrung_monate,
      wartung: row.wartung,
      vorlageGruppen: readGruppen(row.vorlage_gruppen),
      vorlageMahlzeiten: readStrings(row.vorlage_mahlzeiten),
    },
    etag: toVersion(row.version),
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
  };
}

export async function listEssenAuditLog(limit = 100, db: Db = getDb()): Promise<EssenAuditEntry[]> {
  const rows = await db
    .selectFrom('essen.audit_log')
    .selectAll()
    .orderBy('id', 'desc')
    .top(limit)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    actor: row.actor,
    action: row.action,
    details: JSON.parse(row.details) as Record<string, unknown>,
  }));
}

async function audit(
  db: Db,
  actor: string,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  await db
    .insertInto('essen.audit_log')
    .values({ actor, action, details: JSON.stringify(details) })
    .execute();
}

export async function listKategorien(db: Db = getDb()): Promise<EssenKategorie[]> {
  const rows = await db
    .selectFrom('essen.kategorie as k')
    .leftJoin('essen.zutat as z', 'z.kategorie_id', 'k.id')
    .select(['k.id', 'k.version', 'k.name', (eb) => eb.fn.count<number>('z.id').as('zutaten')])
    .groupBy(['k.id', 'k.version', 'k.name'])
    .execute();
  return rows
    .map((row) => ({
      id: row.id,
      etag: toVersion(row.version),
      name: row.name,
      zutaten: Number(row.zutaten),
    }))
    .sort((a, b) => COLLATOR.compare(a.name, b.name));
}

export async function listUnvertraeglichkeiten(
  db: Db = getDb()
): Promise<EssenUnvertraeglichkeit[]> {
  const rows = await db
    .selectFrom('essen.unvertraeglichkeit as u')
    .leftJoin('essen.zutat_unvertraeglichkeit as zu', 'zu.unvertraeglichkeit_id', 'u.id')
    .select([
      'u.id',
      'u.version',
      'u.schluessel',
      'u.name',
      (eb) => eb.fn.count<number>('zu.zutat_id').as('zutaten'),
    ])
    .groupBy(['u.id', 'u.version', 'u.schluessel', 'u.name'])
    .orderBy('u.id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    etag: toVersion(row.version),
    schluessel: row.schluessel,
    name: row.name,
    zutaten: Number(row.zutaten),
  }));
}

export async function listZutaten(db: Db = getDb()): Promise<EssenZutat[]> {
  // One statement, so the allergens always belong to the ingredient rows read.
  const rows = await db
    .selectFrom('essen.zutat as z')
    .selectAll('z')
    .select(
      sql<string | null>`(select string_agg(cast(zu.unvertraeglichkeit_id as varchar(12)), ',')
        from essen.zutat_unvertraeglichkeit zu where zu.zutat_id = z.id)`.as('allergen_ids')
    )
    .execute();
  const number = (value: number | null): number | null => (value === null ? null : Number(value));
  return rows
    .map((row) => ({
      id: row.id,
      etag: toVersion(row.version),
      name: row.name,
      kategorieId: row.kategorie_id,
      einheitenart: row.einheitenart,
      abtropfgewicht: row.abtropfgewicht,
      lebensmittel: row.lebensmittel,
      vegetarisch: row.vegetarisch,
      vegan: row.vegan,
      merkmaleGeprueft: row.merkmale_geprueft,
      hinweis: row.hinweis,
      grammProTl: number(row.gramm_pro_tl),
      grammProEl: number(row.gramm_pro_el),
      grammProStueck: number(row.gramm_pro_stueck),
      allergene: (row.allergen_ids ? row.allergen_ids.split(',').map(Number) : []).sort(
        (a, b) => a - b
      ),
      geaendertAm: row.geaendert_am.toISOString(),
      geaendertVon: row.geaendert_von,
    }))
    .sort((a, b) => COLLATOR.compare(a.name, b.name));
}

/** All Planungen with their owners, newest first. */
export async function listPlanungen(
  aufbewahrungMonate: number,
  db: Db = getDb()
): Promise<EssenPlanungUebersicht[]> {
  const [planungen, tage, mitglieder] = await Promise.all([
    db
      .selectFrom('essen.planung')
      .select(['id', 'version', 'name', 'erstellt_am', 'geaendert_am'])
      .orderBy('id', 'desc')
      .execute(),
    db
      .selectFrom('essen.tag')
      .select([
        'planung_id',
        (eb) => eb.fn.min('datum').as('erster'),
        (eb) => eb.fn.max('datum').as('letzter'),
      ])
      .groupBy('planung_id')
      .execute(),
    db
      .selectFrom('essen.mitglied')
      .select(['planung_id', 'name', 'email', 'rolle'])
      .where('entzogen_am', 'is', null)
      .execute(),
  ]);
  return planungen.map((planung) => {
    const range = tage.find((row) => row.planung_id === planung.id);
    const letzterTag = range?.letzter ? toDateString(range.letzter as Date | string) : null;
    const eigene = mitglieder.filter((mitglied) => mitglied.planung_id === planung.id);
    return {
      id: planung.id,
      etag: toVersion(planung.version),
      name: planung.name,
      ersterTag: range?.erster ? toDateString(range.erster as Date | string) : null,
      letzterTag,
      erstelltAm: planung.erstellt_am.toISOString(),
      geaendertAm: planung.geaendert_am.toISOString(),
      besitzer: eigene
        .filter((mitglied) => mitglied.rolle === 'besitzer')
        .map((mitglied) => ({ name: mitglied.name, email: mitglied.email })),
      mitglieder: eigene.length,
      // Without days the day it was created counts, as in the retention run
      loeschtAm: loeschDatum(
        letzterTag ?? planung.erstellt_am.toISOString().slice(0, 10),
        aufbewahrungMonate
      ),
    };
  });
}

/** Everything the Steuerung shows. */
export async function loadEssenSteuerung(db: Db = getDb()): Promise<EssenSteuerungView> {
  const [stored, kategorien, unvertraeglichkeiten, zutaten, log] = await Promise.all([
    loadEssenEinstellungen(db),
    listKategorien(db),
    listUnvertraeglichkeiten(db),
    listZutaten(db),
    listEssenAuditLog(100, db),
  ]);
  const planungen = await listPlanungen(stored.einstellungen.aufbewahrungMonate, db);
  return { ...stored, kategorien, unvertraeglichkeiten, zutaten, planungen, log };
}

/** Deletes a Planung from the Steuerung if it still has the version `etag`. */
export async function deletePlanungSteuerung(
  id: string,
  etag: string,
  actor: string
): Promise<void> {
  const numericId = readRouteId(id);
  await inTransaction(async (trx) => {
    // Locked until the end, so no change slips in between the version check and the delete
    const { rows } = await sql<{ name: string; version: Buffer }>`
      SELECT name, version FROM essen.planung WITH (UPDLOCK, HOLDLOCK) WHERE id = ${numericId}
    `.execute(trx);
    const row = rows[0];
    if (!row) throw new RecordNotFoundError();
    if (toVersion(row.version) !== etag.replace(/^W\//, '')) throw new VersionConflictError();
    await deletePlanung(trx, numericId);
    await audit(trx, actor, 'planung-geloescht', { id: numericId, name: row.name });
  });
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/** Saves the settings if they still have the version `etag`. */
export async function saveEssenEinstellungen(
  einstellungen: EssenEinstellungen,
  etag: string,
  actor: string
): Promise<void> {
  await inTransaction(async (trx) => {
    const before = await loadEssenEinstellungen(trx);
    const result = await trx
      .updateTable('essen.einstellungen')
      .set({
        anlegen_extern: einstellungen.anlegenExtern,
        whitelist: JSON.stringify(einstellungen.whitelist),
        aufbewahrung_monate: einstellungen.aufbewahrungMonate,
        wartung: einstellungen.wartung,
        vorlage_gruppen: JSON.stringify(einstellungen.vorlageGruppen),
        vorlage_mahlzeiten: JSON.stringify(einstellungen.vorlageMahlzeiten),
        updated_at: sql<Date>`SYSUTCDATETIME()`,
        updated_by: actor,
      })
      .where('id', '=', 1)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();

    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(einstellungen) as (keyof EssenEinstellungen)[]) {
      const from = before.einstellungen[key];
      const to = einstellungen[key];
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        changes[key] = typeof to === 'boolean' || typeof to === 'number' ? { from, to } : true;
      }
    }
    if (Object.keys(changes).length) await audit(trx, actor, 'einstellungen', { changes });
  });
}

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

function readRouteId(id: string): number {
  const numeric = parseId(id);
  if (numeric === undefined) throw new RecordNotFoundError();
  return numeric;
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
    await audit(trx, actor, 'unvertraeglichkeit-geloescht', {
      id: numericId,
      name: row?.name ?? '',
    });
  });
}
