import { sql } from 'kysely';
import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  toDateString,
  toVersion,
  requireRowversion,
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
} from './essen-validation';
import { COLLATOR, readGruppen, readStrings } from './essen-validation';
import { audit, readRouteId } from './essen-audit';
import { deletePlanung } from './essen-planung-loeschen';
import { belegOrdnerAufraeumen } from './essen-belege';
import { loeschDatum } from './essen-planung-model';

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
  // Photos only after the commit; what fails is tried again later
  await belegOrdnerAufraeumen();
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
      .where('version', '=', requireRowversion(etag))
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
