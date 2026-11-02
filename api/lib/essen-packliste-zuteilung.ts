import type { Db } from './db';
import { RecordNotFoundError, VersionConflictError, requireVersion, toVersion } from './db';
import type { PackPersonen, PackZuteilung } from './essen-packliste-model';
import { MAX_PACK_PERSONEN, packlisteSchluessel } from './essen-packliste-model';
import type { Zugang } from './essen-planung';
import { aendere } from './essen-planung';
import { ValidationError } from './validation/errors';

/**
 * The persons who pack an entry of the packing list (`docs/essensplanung.md`, Packliste), each
 * with their own box. The entry's own `gepackt` stays the state of the whole thing: with persons
 * it is whether all of them packed, kept up to date here with every change.
 */

/** The persons of the entries of a Planung, by entry, in the order they were added. */
export async function ladeZuteilungen(
  db: Db,
  planungId: number
): Promise<Map<number, PackZuteilung[]>> {
  const rows = await db
    .selectFrom('essen.packliste_zuteilung as z')
    .innerJoin('essen.packliste_eintrag as p', 'p.id', 'z.eintrag_id')
    .leftJoin('essen.mitglied as m', 'm.id', 'z.mitglied_id')
    .select([
      'z.id',
      'z.version',
      'z.eintrag_id',
      'z.mitglied_id',
      'z.name',
      'z.gepackt',
      'm.name as mitglied_name',
    ])
    .where('p.planung_id', '=', planungId)
    .orderBy('z.id')
    .execute();
  const nachEintrag = new Map<number, PackZuteilung[]>();
  for (const row of rows) {
    const liste = nachEintrag.get(row.eintrag_id) ?? [];
    liste.push({
      id: row.id,
      etag: toVersion(row.version),
      mitgliedId: row.mitglied_id,
      name: row.mitglied_id === null ? row.name : (row.mitglied_name ?? ''),
      gepackt: row.gepackt,
    });
    nachEintrag.set(row.eintrag_id, liste);
  }
  return nachEintrag;
}

/** The persons of one entry, with the names of the members. */
async function personenVon(trx: Db, eintragId: number) {
  return trx
    .selectFrom('essen.packliste_zuteilung as z')
    .leftJoin('essen.mitglied as m', 'm.id', 'z.mitglied_id')
    .select(['z.id', 'z.mitglied_id', 'z.name', 'z.gepackt', 'm.name as mitglied_name'])
    .where('z.eintrag_id', '=', eintragId)
    .orderBy('z.id')
    .execute();
}

/**
 * The entry is packed when all its persons packed; without persons it keeps its own box. Writes
 * only a change, so a tick that changes nothing of the whole keeps the entry's version.
 */
export async function eintragNachfuehren(
  trx: Db,
  eintrag: { id: number; gepackt: boolean },
  /** Persons were added or taken off: the entry gets a new version even with the same state. */
  personenGeaendert = false
): Promise<void> {
  const personen = await personenVon(trx, eintrag.id);
  const alle = personen.length ? personen.every((person) => person.gepackt) : eintrag.gepackt;
  // A new version keeps a tick of the whole entry shown before from packing persons added since
  if (alle !== eintrag.gepackt || personenGeaendert) {
    await trx
      .updateTable('essen.packliste_eintrag')
      .set({ gepackt: alle })
      .where('id', '=', eintrag.id)
      .execute();
  }
}

/** Packs or unpacks the whole entry: its own box and the boxes of all its persons. */
export async function allePacken(trx: Db, eintragId: number, gepackt: boolean): Promise<void> {
  await trx
    .updateTable('essen.packliste_zuteilung')
    .set({ gepackt })
    .where('eintrag_id', '=', eintragId)
    .where('gepackt', '<>', gepackt)
    .execute();
}

/**
 * Adds and takes off persons of an entry. Adding one who is there already, or taking off one who
 * is gone, changes nothing, so changes of several people merge without a conflict. A member gets
 * new things only with access; a member without access stays until taken off. Persons added to
 * an entry without persons start with its state, later ones have still to pack. Returns the
 * names added and taken off, for the log.
 */
export async function personenAendern(
  trx: Db,
  zugang: Zugang,
  eintrag: { id: number; gepackt: boolean },
  hinzu: PackPersonen = { mitglieder: [], namen: [] },
  weg: number[] = []
): Promise<{ hinzu: string[]; weg: string[] }> {
  const vorher = await personenVon(trx, eintrag.id);
  const genannt = (person: (typeof vorher)[number]) =>
    person.mitglied_id === null ? person.name : (person.mitglied_name ?? '');
  const entfernt = vorher.filter((person) => weg.includes(person.id));
  if (entfernt.length) {
    await trx
      .deleteFrom('essen.packliste_zuteilung')
      .where('eintrag_id', '=', eintrag.id)
      .where(
        'id',
        'in',
        entfernt.map((person) => person.id)
      )
      .execute();
  }
  const bleiben = vorher.filter((person) => !weg.includes(person.id));
  const start = vorher.length === 0 ? eintrag.gepackt : false;

  const neueMitglieder = hinzu.mitglieder.filter(
    (id) => !bleiben.some((person) => person.mitglied_id === id)
  );
  const mitglieder = neueMitglieder.length
    ? await trx
        .selectFrom('essen.mitglied')
        .select(['id', 'name', 'entzogen_am'])
        .where('planung_id', '=', zugang.planungId)
        .where('id', 'in', neueMitglieder)
        .execute()
    : [];
  if (
    mitglieder.length !== neueMitglieder.length ||
    mitglieder.some((mitglied) => mitglied.entzogen_am)
  ) {
    throw new ValidationError({ mitglieder: 'Bitte aus der Liste wählen.' });
  }
  const freie = new Set(
    bleiben.filter((p) => p.mitglied_id === null).map((p) => packlisteSchluessel(p.name))
  );
  const neueNamen = hinzu.namen.filter((name) => !freie.has(packlisteSchluessel(name)));
  if (freie.size + neueNamen.length > MAX_PACK_PERSONEN) {
    throw new ValidationError({ namen: `Höchstens ${MAX_PACK_PERSONEN} Namen.` });
  }
  // In the order asked, so „Alle“ adds the members in the order of the page
  const reihe = [
    ...neueMitglieder.map((id) => ({ mitglied_id: id, name: '' })),
    ...neueNamen.map((name) => ({ mitglied_id: null, name })),
  ];
  for (const person of reihe) {
    await trx
      .insertInto('essen.packliste_zuteilung')
      .values({ eintrag_id: eintrag.id, ...person, gepackt: start })
      .execute();
  }
  if (reihe.length || entfernt.length) await eintragNachfuehren(trx, eintrag, true);
  return {
    hinzu: [
      ...neueMitglieder.map((id) => mitglieder.find((m) => m.id === id)?.name ?? ''),
      ...neueNamen,
    ],
    weg: entfernt.map(genannt),
  };
}

/**
 * Packs or unpacks one person's share, on the version it was shown with; shares of others are
 * no conflict. The entry follows (`eintragNachfuehren`).
 */
export async function zuteilungAbhaken(
  zugang: Zugang,
  id: number,
  gepackt: boolean,
  etag: string
): Promise<void> {
  await aendere(zugang, 'packliste-geaendert', async (trx) => {
    const zuteilung = await trx
      .selectFrom('essen.packliste_zuteilung as z')
      .innerJoin('essen.packliste_eintrag as p', 'p.id', 'z.eintrag_id')
      .leftJoin('essen.mitglied as m', 'm.id', 'z.mitglied_id')
      .select([
        'p.id as eintrag_id',
        'p.name as eintrag_name',
        'p.gepackt as eintrag_gepackt',
        'z.mitglied_id',
        'z.name',
        'm.name as mitglied_name',
      ])
      .where('z.id', '=', id)
      .where('p.planung_id', '=', zugang.planungId)
      .executeTakeFirst();
    if (!zuteilung) throw new RecordNotFoundError();
    const result = await trx
      .updateTable('essen.packliste_zuteilung')
      .set({ gepackt })
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    await eintragNachfuehren(trx, {
      id: zuteilung.eintrag_id,
      gepackt: zuteilung.eintrag_gepackt,
    });
    const fuer = zuteilung.mitglied_id === null ? zuteilung.name : (zuteilung.mitglied_name ?? '');
    return { result: undefined, details: { name: zuteilung.eintrag_name, gepackt, fuer } };
  });
}
