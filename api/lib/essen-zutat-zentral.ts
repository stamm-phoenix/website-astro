import type { Db } from './db';
import { RecordNotFoundError, getDb, inTransaction, lockResource } from './db';
import { audit } from './essen-audit';
import { zutatSperre } from './essen-gerichte-model';
import { createZutatIn, eindeutigerZutatName } from './essen-katalog-pflege';
import { katalogGeaendert } from './essen-katalog-stand';
import type { PlanungsZutat } from './essen-zutat-zentral-model';
import { aufZentraleZutat } from './essen-zutat-zusammenlegen';
import { validateZutat } from './essen-validation';
import { ValidationError } from './validation/errors';

/**
 * The Steuerung takes own ingredients of the Planungen into the central list and merges
 * duplicates of the list (`docs/essensplanung.md`, „Zentrale Zutatenliste“).
 */

const klein = (name: string) => name.toLocaleLowerCase('de').trim();

/** Own ingredients of all Planungen, by name, with the values of the most recent one. */
export async function listPlanungsZutaten(db: Db = getDb()): Promise<PlanungsZutat[]> {
  const [zeilen, allergene, zentrale] = await Promise.all([
    db
      .selectFrom('essen.planung_zutat as pz')
      .innerJoin('essen.planung as p', 'p.id', 'pz.planung_id')
      .select([
        'pz.id',
        'pz.name',
        'pz.kategorie_id',
        'pz.einheitenart',
        'pz.lebensmittel',
        'pz.vegetarisch',
        'pz.vegan',
        'pz.angaben_offen',
        'p.name as planung',
      ])
      .where('pz.zutat_id', 'is', null)
      .orderBy('pz.id', 'desc')
      .execute(),
    db
      .selectFrom('essen.planung_zutat_unvertraeglichkeit')
      .select(['planung_zutat_id', 'unvertraeglichkeit_id'])
      .execute(),
    db.selectFrom('essen.zutat').select(['id', 'name']).execute(),
  ]);
  const zentral = new Map(zentrale.map((z) => [klein(z.name), z.id]));
  const enthaelt = new Map<number, number[]>();
  for (const row of allergene) {
    enthaelt.set(row.planung_zutat_id, [
      ...(enthaelt.get(row.planung_zutat_id) ?? []),
      row.unvertraeglichkeit_id,
    ]);
  }
  const gruppen = new Map<string, PlanungsZutat>();
  for (const zeile of zeilen) {
    const schluessel = klein(zeile.name ?? '');
    const gruppe = gruppen.get(schluessel);
    if (gruppe) {
      gruppe.ids.push(zeile.id);
      if (!gruppe.planungen.includes(zeile.planung)) gruppe.planungen.push(zeile.planung);
      continue;
    }
    // The newest one comes first and gives the values
    gruppen.set(schluessel, {
      name: zeile.name ?? '',
      ids: [zeile.id],
      planungen: [zeile.planung],
      kategorieId: zeile.kategorie_id!,
      einheitenart: zeile.einheitenart!,
      lebensmittel: zeile.lebensmittel,
      vegetarisch: zeile.vegetarisch,
      vegan: zeile.vegan,
      allergene: (enthaelt.get(zeile.id) ?? []).sort((a, b) => a - b),
      angabenOffen: zeile.angaben_offen,
      zentralId: zentral.get(schluessel) ?? null,
    });
  }
  return [...gruppen.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Takes the own ingredients of the Planungen named `name` into the central list: as the existing
 * central ingredient `zielId`, or as a new one from `zutat` (the form of the Steuerung). Afterwards
 * they are the central ingredient in every Planung.
 */
export async function planungsZutatUebernehmen(
  body: Record<string, unknown> | null,
  actor: string
): Promise<{ zutatId: number; planungen: number }> {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) throw new ValidationError({ name: 'Bitte eine Zutat der Planungen wählen.' });
  const zielId = body?.zielId;
  const ziel = typeof zielId === 'number' && Number.isInteger(zielId) && zielId > 0 ? zielId : null;
  const neu = ziel === null ? validateZutat(body?.zutat) : null;
  return eindeutigerZutatName(() =>
    inTransaction(async (trx) => {
      const ids = (
        await trx
          .selectFrom('essen.planung_zutat')
          .select('id')
          .where('zutat_id', 'is', null)
          .where('name', '=', name)
          .execute()
      ).map((row) => row.id);
      if (!ids.length) throw new RecordNotFoundError();
      let zutatId: number;
      if (ziel !== null) {
        const vorhanden = await trx
          .selectFrom('essen.zutat')
          .select('name')
          .where('id', '=', ziel)
          .executeTakeFirst();
        if (!vorhanden)
          throw new ValidationError({ zielId: 'Diese Zutat gibt es nicht mehr. Bitte neu laden.' });
        zutatId = ziel;
        await audit(trx, actor, 'zutat-uebernommen', { id: ziel, name: vorhanden.name, von: name });
      } else {
        zutatId = await createZutatIn(trx, neu!, actor, 'zutat-uebernommen');
      }
      const planungen = await aufZentraleZutat(trx, ids, zutatId, { name });
      await katalogGeaendert(trx);
      return { zutatId, planungen };
    })
  );
}

/**
 * Merges the central ingredient `von` into `nach`: the Planungen use `nach` instead, then `von`
 * is deleted. Its differences in a Planung stay with the ingredient there.
 */
export async function zentraleZutatenZusammenlegen(
  von: number,
  nach: number,
  actor: string
): Promise<number> {
  if (von === nach) throw new ValidationError({ von: 'Bitte zwei verschiedene Zutaten wählen.' });
  return inTransaction(async (trx) => {
    // In order of the ids, so two merges at the same time cannot wait for each other
    for (const id of [von, nach].sort((a, b) => a - b)) await lockResource(trx, zutatSperre(id));
    const zutaten = await trx
      .selectFrom('essen.zutat')
      .select(['id', 'name'])
      .where('id', 'in', [von, nach])
      .execute();
    const alt = zutaten.find((z) => z.id === von);
    const bleibt = zutaten.find((z) => z.id === nach);
    if (!alt || !bleibt) throw new RecordNotFoundError();
    const ids = (
      await trx.selectFrom('essen.planung_zutat').select('id').where('zutat_id', '=', von).execute()
    ).map((row) => row.id);
    const planungen = await aufZentraleZutat(trx, ids, nach, { name: alt.name, nach: bleibt.name });
    await trx.deleteFrom('essen.zutat').where('id', '=', von).execute();
    await katalogGeaendert(trx);
    await audit(trx, actor, 'zutat-zusammengelegt', {
      id: nach,
      name: bleibt.name,
      von: alt.name,
    });
    return planungen;
  });
}
