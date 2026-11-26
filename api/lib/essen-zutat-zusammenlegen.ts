import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import type { Database } from './db-schema';
import { lockResource } from './db';
import { zutatSperre } from './essen-gerichte-model';

/**
 * Ingredients of a Planung that become one (`docs/essensplanung.md`, „Zentrale Zutatenliste“):
 * an own ingredient taken over into the central list, or two central ones merged. Runs in the
 * transaction of the Steuerung; every Planung it touches gets a change of its own, so its pages
 * load the new state.
 */

/** Logs a change of the Steuerung in a Planung and bumps its counter (also in maintenance). */
export async function steuerungAenderung(
  trx: Transaction<Database>,
  planungId: number,
  details: Record<string, unknown>
): Promise<void> {
  const bumped = await trx
    .updateTable('essen.planung')
    .set({
      aenderung_seq: sql<string>`aenderung_seq + 1`,
      geaendert_am: sql<Date>`SYSUTCDATETIME()`,
    })
    .output('inserted.aenderung_seq')
    .where('id', '=', planungId)
    .executeTakeFirst();
  if (!bumped) return;
  await trx
    .insertInto('essen.aenderung')
    .values({
      planung_id: planungId,
      seq: bumped.aenderung_seq,
      mitglied_id: null,
      aktion: 'zutat-zentral',
      details: JSON.stringify(details),
    })
    .execute();
}

/**
 * Moves everything of the ingredient `von` of a Planung to `nach` of the same Planung and deletes
 * `von`. Where both have a row that must be unique (something bought or used per trip or meal and
 * unit), the amounts are added; a rule of a trip of `nach` wins over one of `von`.
 */
export async function planungZutatZusammenlegen(
  trx: Transaction<Database>,
  von: number,
  nach: number
): Promise<void> {
  for (const tabelle of ['gericht_zutat', 'bestand', 'zusatzbedarf'] as const) {
    await sql`update ${sql.table(`essen.${tabelle}`)} set planung_zutat_id = ${nach}
      where planung_zutat_id = ${von}`.execute(trx);
  }
  // Bought per trip and unit: the amounts are added
  await sql`update t set t.erhalten = t.erhalten + s.erhalten
    from essen.einkauf_posten t
    join essen.einkauf_posten s on s.einkauf_id = t.einkauf_id and s.einheit = t.einheit
    where t.planung_zutat_id = ${nach} and s.planung_zutat_id = ${von}`.execute(trx);
  await sql`delete s from essen.einkauf_posten s
    where s.planung_zutat_id = ${von} and exists (select 1 from essen.einkauf_posten t
      where t.planung_zutat_id = ${nach} and t.einkauf_id = s.einkauf_id and t.einheit = s.einheit)`.execute(
    trx
  );
  await sql`update essen.einkauf_posten set planung_zutat_id = ${nach}
    where planung_zutat_id = ${von}`.execute(trx);
  // One rule per trip: the one of `nach` stays
  await sql`delete s from essen.einkauf_regel s
    where s.planung_zutat_id = ${von} and exists (select 1 from essen.einkauf_regel t
      where t.planung_zutat_id = ${nach} and t.einkauf_id = s.einkauf_id)`.execute(trx);
  await sql`update essen.einkauf_regel set planung_zutat_id = ${nach}
    where planung_zutat_id = ${von}`.execute(trx);
  // Used per cooked dish and unit: the amounts are added
  await sql`update t set t.menge = t.menge + s.menge
    from essen.einplanung_verbrauch t
    join essen.einplanung_verbrauch s on s.einplanung_id = t.einplanung_id and s.einheit = t.einheit
    where t.planung_zutat_id = ${nach} and s.planung_zutat_id = ${von}`.execute(trx);
  await sql`delete s from essen.einplanung_verbrauch s
    where s.planung_zutat_id = ${von} and exists (select 1 from essen.einplanung_verbrauch t
      where t.planung_zutat_id = ${nach} and t.einplanung_id = s.einplanung_id and t.einheit = s.einheit)`.execute(
    trx
  );
  await sql`update essen.einplanung_verbrauch set planung_zutat_id = ${nach}
    where planung_zutat_id = ${von}`.execute(trx);
  // The shop of `von` is kept when `nach` has none
  await sql`update n set n.geschaeft_id = v.geschaeft_id
    from essen.planung_zutat n join essen.planung_zutat v on v.id = ${von}
    where n.id = ${nach} and n.geschaeft_id is null`.execute(trx);
  await trx.deleteFrom('essen.planung_zutat').where('id', '=', von).execute();
}

/**
 * Makes the ingredients `ids` of the Planungen (own or central) the central ingredient
 * `zentralId`: where a Planung has it already, they are merged into it; otherwise they point to
 * it, own ones lose their own name, diet and allergens, central ones keep their differences.
 * Returns the Planungen touched.
 */
export async function aufZentraleZutat(
  trx: Transaction<Database>,
  ids: readonly number[],
  zentralId: number,
  details: Record<string, unknown>
): Promise<number> {
  if (!ids.length) return 0;
  await lockResource(trx, zutatSperre(zentralId));
  const zeilen = await trx
    .selectFrom('essen.planung_zutat')
    .select(['id', 'planung_id', 'zutat_id'])
    .where('id', 'in', [...ids])
    .orderBy('planung_id')
    .execute();
  const planungen = new Set<number>();
  for (const zeile of zeilen) {
    if (!planungen.has(zeile.planung_id)) {
      // The change first: it locks the Planung against its own changes meanwhile
      await steuerungAenderung(trx, zeile.planung_id, details);
      planungen.add(zeile.planung_id);
    }
    const vorhanden = await trx
      .selectFrom('essen.planung_zutat')
      .select('id')
      .where('planung_id', '=', zeile.planung_id)
      .where('zutat_id', '=', zentralId)
      .executeTakeFirst();
    if (vorhanden && vorhanden.id !== zeile.id) {
      await planungZutatZusammenlegen(trx, zeile.id, vorhanden.id);
    } else if (zeile.zutat_id === null) {
      await trx
        .deleteFrom('essen.planung_zutat_unvertraeglichkeit')
        .where('planung_zutat_id', '=', zeile.id)
        .execute();
      await trx
        .updateTable('essen.planung_zutat')
        .set({
          zutat_id: zentralId,
          name: null,
          kategorie_id: null,
          einheitenart: null,
          vegetarisch: null,
          vegan: null,
          lebensmittel: true,
          angaben_offen: false,
        })
        .where('id', '=', zeile.id)
        .execute();
    } else {
      await trx
        .updateTable('essen.planung_zutat')
        .set({ zutat_id: zentralId })
        .where('id', '=', zeile.id)
        .execute();
    }
  }
  return planungen.size;
}
