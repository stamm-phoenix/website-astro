import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import type { Database } from './db-schema';
import { VersionConflictError, requireVersion } from './db';
import type { EinheitenZeileInput } from './essen-einheiten-model';
import type { EinplanungStatus } from './essen-kochen-model';
import type { Zugang } from './essen-planung';
import { aendere } from './essen-planung';
import { zutatDerPlanung } from './essen-planung-zutat';
import { ValidationError } from './validation/errors';

/**
 * Saves the amounts of one ingredient converted into one unit (`docs/essensplanung.md`,
 * „Einheiten“), all or none in one change: lines of dishes, extra needs and stock, and what the
 * stock is worked out from (used by cooked dishes, bought on trips, fixed on trips), so it stays
 * in the same unit as the needs. Each with the version the page showed; a change meanwhile is a
 * conflict, and nothing is saved. Amounts are never dropped: entries of a cooked dish or a trip
 * that end up in the same unit are added up.
 */

type Trx = Transaction<Database>;

const TABELLE = {
  gericht: 'essen.gericht_zutat',
  zusatzbedarf: 'essen.zusatzbedarf',
  bestand: 'essen.bestand',
} as const;

const gleich = (a: string, b: string) => a.toLocaleLowerCase('de') === b.toLocaleLowerCase('de');

/** Units compared like the database does, upper and lower case alike. */
const schluessel = (einheit: string) => einheit.toLocaleLowerCase('de');

const rund = (menge: number) => Math.round(menge * 1000) / 1000;

function gruppiere<T, K>(liste: readonly T[], key: (eintrag: T) => K): Map<K, T[]> {
  const gruppen = new Map<K, T[]>();
  for (const eintrag of liste)
    gruppen.set(key(eintrag), [...(gruppen.get(key(eintrag)) ?? []), eintrag]);
  return gruppen;
}

function geaendert(result: { numUpdatedRows: bigint }): void {
  if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
}

/** A line of a dish, extra needs or stock, on its version. */
async function zeileUmrechnen(
  trx: Trx,
  zugang: Zugang,
  planungZutatId: number,
  zeile: EinheitenZeileInput
): Promise<void> {
  const version = requireVersion(zeile.etag);
  if (zeile.stelle === 'gericht') {
    // A line of a dish reaches its Planung through its dish
    geaendert(
      await trx
        .updateTable('essen.gericht_zutat')
        .set({ menge: zeile.menge, einheit: zeile.einheit })
        .where('id', '=', zeile.id)
        .where('planung_zutat_id', '=', planungZutatId)
        .where('menge', 'is not', null)
        .where('gericht_id', 'in', (eb) =>
          eb.selectFrom('essen.gericht').select('id').where('planung_id', '=', zugang.planungId)
        )
        .where('version', '=', version)
        .executeTakeFirst()
    );
    return;
  }
  // Stock and extra needs have the same columns
  geaendert(
    await trx
      .updateTable(TABELLE[zeile.stelle as 'bestand'] as 'essen.bestand')
      .set({ menge: zeile.menge, einheit: zeile.einheit })
      .where('id', '=', zeile.id)
      .where('planung_zutat_id', '=', planungZutatId)
      .where('planung_id', '=', zugang.planungId)
      .where('menge', 'is not', null)
      .where('version', '=', version)
      .executeTakeFirst()
  );
}

/**
 * What cooked dishes used: per planned dish (on its version) its entries of the ingredient are
 * written anew, converted ones in the new unit, the same unit added up. The planned dish gets a
 * new version, so a tick of others meanwhile is a conflict.
 */
async function verbrauchUmrechnen(
  trx: Trx,
  zugang: Zugang,
  planungZutatId: number,
  zeilen: EinheitenZeileInput[]
): Promise<void> {
  const jeEinplanung = gruppiere(zeilen, (zeile) => zeile.id);
  for (const [einplanungId, eintraege] of jeEinplanung) {
    const etag = eintraege[0].etag;
    if (eintraege.some((e) => e.etag !== etag)) throw new VersionConflictError();
    // A new version; refused when the dish changed or is of another Planung
    geaendert(
      await trx
        .updateTable('essen.einplanung')
        .set({ status: sql<EinplanungStatus>`status` })
        .where('id', '=', einplanungId)
        .where('status', '=', 'gekocht')
        .where('version', '=', requireVersion(etag))
        .where('mahlzeit_id', 'in', (eb) =>
          eb
            .selectFrom('essen.mahlzeit as m')
            .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
            .select('m.id')
            .where('t.planung_id', '=', zugang.planungId)
        )
        .executeTakeFirst()
    );
    const vorhanden = await trx
      .selectFrom('essen.einplanung_verbrauch')
      .select(['id', 'menge', 'einheit'])
      .where('einplanung_id', '=', einplanungId)
      .where('planung_zutat_id', '=', planungZutatId)
      .execute();
    const neu = new Map<string, { einheit: string; menge: number }>();
    const rest = [...vorhanden];
    const add = (einheit: string, menge: number) => {
      const summe = neu.get(schluessel(einheit));
      if (summe) summe.menge = rund(summe.menge + menge);
      else neu.set(schluessel(einheit), { einheit, menge: rund(menge) });
    };
    for (const eintrag of eintraege) {
      const index = rest.findIndex((row) => gleich(row.einheit, eintrag.von));
      // Same version, but the entry is gone: the page showed something else
      if (index < 0) throw new VersionConflictError();
      rest.splice(index, 1);
      add(eintrag.einheit, eintrag.menge);
    }
    for (const row of rest) add(row.einheit, Number(row.menge));
    await trx
      .deleteFrom('essen.einplanung_verbrauch')
      .where(
        'id',
        'in',
        vorhanden.map((row) => row.id)
      )
      .execute();
    await trx
      .insertInto('essen.einplanung_verbrauch')
      .values(
        [...neu.values()].map((v) => ({
          einplanung_id: einplanungId,
          planung_zutat_id: planungZutatId,
          menge: v.menge,
          einheit: v.einheit,
        }))
      )
      .execute();
  }
}

/**
 * What was bought on trips: each thing ticked off on its version. Things of one trip that end up
 * in the same unit become one, with what was bought added up and the replacements kept.
 */
async function erhaltenUmrechnen(
  trx: Trx,
  zugang: Zugang,
  planungZutatId: number,
  zeilen: EinheitenZeileInput[]
): Promise<void> {
  const einkaeufe = new Set<number>();
  for (const zeile of zeilen) {
    const posten = await trx
      .selectFrom('essen.einkauf_posten as p')
      .innerJoin('essen.einkauf as e', 'e.id', 'p.einkauf_id')
      .select(['p.einkauf_id'])
      .where('p.id', '=', zeile.id)
      .where('p.planung_zutat_id', '=', planungZutatId)
      .where('e.planung_id', '=', zugang.planungId)
      .executeTakeFirst();
    if (!posten) throw new VersionConflictError();
    einkaeufe.add(posten.einkauf_id);
  }
  // First all new amounts, on the versions shown; a unit taken twice would clash until merged
  const neu = new Map(zeilen.map((zeile) => [zeile.id, zeile]));
  for (const einkaufId of einkaeufe) {
    const alle = await trx
      .selectFrom('essen.einkauf_posten')
      .select(['id', 'version', 'einheit', 'erhalten', 'ersatz', 'abgehakt_stand'])
      .where('einkauf_id', '=', einkaufId)
      .where('planung_zutat_id', '=', planungZutatId)
      .orderBy('id')
      .execute();
    for (const zeile of zeilen.filter((z) => alle.some((row) => row.id === z.id))) {
      const gesehen = await trx
        .selectFrom('essen.einkauf_posten')
        .select('id')
        .where('id', '=', zeile.id)
        .where('version', '=', requireVersion(zeile.etag))
        .executeTakeFirst();
      if (!gesehen) throw new VersionConflictError();
    }
    const gruppen = gruppiere(alle, (row) => schluessel(neu.get(row.id)?.einheit ?? row.einheit));
    for (const gruppe of gruppen.values()) {
      const [erster, ...weitere] = gruppe;
      const menge = rund(
        gruppe.reduce((summe, row) => summe + (neu.get(row.id)?.menge ?? Number(row.erhalten)), 0)
      );
      const ersatz = [...new Set(gruppe.map((row) => row.ersatz).filter(Boolean))]
        .join(', ')
        .slice(0, 100);
      // When it was ticked off stays as it was (the newest tick of those merged), so needs put
      // on the list later are not taken for done because of the new version
      const stand = gruppe
        .map((row) => Buffer.from(row.abgehakt_stand ?? row.version))
        .reduce((neuester, s) => (Buffer.compare(s, neuester) > 0 ? s : neuester));
      if (weitere.length)
        await trx
          .deleteFrom('essen.einkauf_posten')
          .where(
            'id',
            'in',
            weitere.map((row) => row.id)
          )
          .execute();
      if (neu.has(erster.id) || weitere.length)
        await trx
          .updateTable('essen.einkauf_posten')
          .set({
            einheit: neu.get(erster.id)?.einheit ?? erster.einheit,
            erhalten: menge,
            ersatz,
            abgehakt_stand: stand,
          })
          .where('id', '=', erster.id)
          .execute();
    }
  }
}

/** Fixed amounts on trips, each on the version of its trip, which then gets a new one. */
async function festUmrechnen(
  trx: Trx,
  zugang: Zugang,
  planungZutatId: number,
  zeilen: EinheitenZeileInput[]
): Promise<void> {
  for (const zeile of zeilen) {
    geaendert(
      await trx
        .updateTable('essen.einkauf')
        .set({ name: sql<string>`name` })
        .where('id', '=', zeile.id)
        .where('planung_id', '=', zugang.planungId)
        .where('version', '=', requireVersion(zeile.etag))
        .executeTakeFirst()
    );
    geaendert(
      await trx
        .updateTable('essen.einkauf_regel')
        .set({ menge: zeile.menge, einheit: zeile.einheit })
        .where('einkauf_id', '=', zeile.id)
        .where('planung_zutat_id', '=', planungZutatId)
        .where('art', '=', 'fest')
        .executeTakeFirst()
    );
  }
}

export async function einheitenUebernehmen(
  zugang: Zugang,
  planungZutatId: number,
  zeilen: EinheitenZeileInput[]
): Promise<void> {
  if (!zeilen.length)
    throw new ValidationError({ zeilen: 'Bitte mindestens eine Menge umrechnen.' });
  await aendere(zugang, 'einheiten-vereinheitlicht', async (trx) => {
    const zutat = await zutatDerPlanung(trx, zugang, planungZutatId);
    const je = gruppiere(zeilen, (zeile) => zeile.stelle);
    for (const zeile of [
      ...(je.get('gericht') ?? []),
      ...(je.get('zusatzbedarf') ?? []),
      ...(je.get('bestand') ?? []),
    ])
      await zeileUmrechnen(trx, zugang, planungZutatId, zeile);
    await verbrauchUmrechnen(trx, zugang, planungZutatId, je.get('verbrauch') ?? []);
    await erhaltenUmrechnen(trx, zugang, planungZutatId, je.get('erhalten') ?? []);
    await festUmrechnen(trx, zugang, planungZutatId, je.get('fest') ?? []);
    return {
      result: undefined,
      details: { name: zutat.name ?? zutat.z_name, anzahl: zeilen.length },
    };
  });
}
