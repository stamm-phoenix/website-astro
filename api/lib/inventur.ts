import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  requireVersion,
  toVersion,
} from './db';
import type { Db } from './db';
import type { InventarArtikelTable, InventarVarianteTable } from './db-schema-inventur';
import type {
  InventarArtikel,
  InventarArtikelInput,
  InventarVariante,
  InventarZaehlungInput,
} from './inventur-model';
import { ValidationError } from './validation/errors';

/**
 * The module „Inventur“ (#107, `organisation.inventar_artikel` and `inventar_variante`,
 * migration `0067_inventur.sql`): the stock of the Stammesmaterial with size or motif, storage
 * place, condition and the last count. Every change checks the version of the article, so
 * nobody overwrites a stock unnoticed.
 */

function toVariante(row: Selectable<InventarVarianteTable>): InventarVariante {
  return {
    id: row.id,
    bezeichnung: row.bezeichnung,
    bestand: row.bestand,
    gezaehltAm: row.gezaehlt_am?.toISOString() ?? null,
    gezaehltVon: row.gezaehlt_von,
  };
}

function toArtikel(
  row: Selectable<InventarArtikelTable>,
  varianten: InventarVariante[]
): InventarArtikel {
  return {
    id: row.id,
    bezeichnung: row.bezeichnung,
    kategorie: row.kategorie,
    einheit: row.einheit,
    lagerort: row.lagerort,
    zustand: row.zustand,
    zubehoer: row.zubehoer,
    fehlend: row.fehlend,
    notizen: row.notizen,
    varianten,
    bestand: varianten.reduce((sum, v) => sum + v.bestand, 0),
    etag: toVersion(row.version),
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
  };
}

/** All articles with their variants, by category and name. */
export async function getInventar(): Promise<InventarArtikel[]> {
  const db = getDb();
  const [artikel, varianten] = await Promise.all([
    db.selectFrom('organisation.inventar_artikel').selectAll().execute(),
    db
      .selectFrom('organisation.inventar_variante')
      .selectAll()
      .orderBy('sortierung')
      .orderBy('id')
      .execute(),
  ]);
  const byArtikel = new Map<number, InventarVariante[]>();
  for (const row of varianten) {
    const list = byArtikel.get(row.artikel_id) ?? [];
    list.push(toVariante(row));
    byArtikel.set(row.artikel_id, list);
  }
  return artikel
    .map((row) => toArtikel(row, byArtikel.get(row.id) ?? []))
    .sort(
      (a, b) =>
        a.kategorie.localeCompare(b.kategorie) || a.bezeichnung.localeCompare(b.bezeichnung, 'de')
    );
}

function toRow(input: InventarArtikelInput) {
  return {
    bezeichnung: input.bezeichnung,
    kategorie: input.kategorie,
    einheit: input.einheit,
    lagerort: input.lagerort,
    zustand: input.zustand,
    zubehoer: input.zubehoer,
    fehlend: input.fehlend,
    notizen: input.notizen,
  };
}

export async function createInventarArtikel(
  input: InventarArtikelInput,
  actor: string
): Promise<number> {
  return inTransaction(async (trx) => {
    const { id } = await trx
      .insertInto('organisation.inventar_artikel')
      .values({ ...toRow(input), updated_by: actor })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('organisation.inventar_variante')
      .values(
        input.varianten.map((v, index) => ({
          artikel_id: id,
          bezeichnung: v.bezeichnung,
          bestand: v.bestand,
          sortierung: index,
        }))
      )
      .execute();
    return id;
  });
}

/** Tells a vanished article from one changed by someone else. */
async function notChanged(db: Db, id: number): Promise<never> {
  const exists = await db
    .selectFrom('organisation.inventar_artikel')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

/** Marks the article as changed if it still has the version `etag`; the version moves on. */
async function touch(db: Db, id: number, etag: string, actor: string): Promise<void> {
  const result = await db
    .updateTable('organisation.inventar_artikel')
    .set({ updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) await notChanged(db, id);
}

/** Saves an article with all its variants if it still has the version `etag`. */
export async function updateInventarArtikel(
  id: number,
  input: InventarArtikelInput,
  etag: string,
  actor: string
): Promise<void> {
  await inTransaction(async (trx) => {
    const result = await trx
      .updateTable('organisation.inventar_artikel')
      .set({ ...toRow(input), updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) await notChanged(trx, id);

    const existing = await trx
      .selectFrom('organisation.inventar_variante')
      .select('id')
      .where('artikel_id', '=', id)
      .execute();
    const known = new Set(existing.map((row) => row.id));
    const kept = new Set(input.varianten.flatMap((v) => (v.id === null ? [] : [v.id])));
    if ([...kept].some((variante) => !known.has(variante)))
      throw new ValidationError({
        varianten: 'Eine Größe oder ein Motiv wurde inzwischen entfernt. Bitte neu laden.',
      });
    const removed = [...known].filter((variante) => !kept.has(variante));
    if (removed.length)
      await trx.deleteFrom('organisation.inventar_variante').where('id', 'in', removed).execute();
    for (const [index, v] of input.varianten.entries()) {
      if (v.id === null) {
        await trx
          .insertInto('organisation.inventar_variante')
          .values({
            artikel_id: id,
            bezeichnung: v.bezeichnung,
            bestand: v.bestand,
            sortierung: index,
          })
          .execute();
      } else {
        await trx
          .updateTable('organisation.inventar_variante')
          .set({ bezeichnung: v.bezeichnung, bestand: v.bestand, sortierung: index })
          .where('id', '=', v.id)
          .execute();
      }
    }
  });
}

/**
 * Saves a count: the stock of every variant of the article, with time and counting person.
 * Needs every variant, so a count never leaves one out by accident.
 */
export async function zaehleInventarArtikel(
  id: number,
  input: InventarZaehlungInput,
  etag: string,
  actor: string
): Promise<void> {
  await inTransaction(async (trx) => {
    await touch(trx, id, etag, actor);
    const rows = await trx
      .selectFrom('organisation.inventar_variante')
      .select('id')
      .where('artikel_id', '=', id)
      .execute();
    const counted = new Set(input.varianten.map((v) => v.id));
    if (
      counted.size !== input.varianten.length ||
      counted.size !== rows.length ||
      rows.some((row) => !counted.has(row.id))
    )
      throw new ValidationError({
        varianten: 'Bitte für jede Größe oder jedes Motiv den gezählten Bestand angeben.',
      });
    for (const v of input.varianten) {
      await trx
        .updateTable('organisation.inventar_variante')
        .set({ bestand: v.bestand, gezaehlt_am: sql<Date>`SYSUTCDATETIME()`, gezaehlt_von: actor })
        .where('id', '=', v.id)
        .execute();
    }
  });
}

/** Deletes an article with its variants if it still has the version `etag`. */
export async function deleteInventarArtikel(id: number, etag: string): Promise<void> {
  const db = getDb();
  const result = await db
    .deleteFrom('organisation.inventar_artikel')
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) await notChanged(db, id);
}
