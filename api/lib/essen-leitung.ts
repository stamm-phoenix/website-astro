import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from './db';
import { getSqlErrorNumber, inTransaction, lockResource, toDateString } from './db';
import type { PlanungRolle } from './essen-planung-model';
import type { LeitungPlanung } from './essen-leitung-model';
import { istStammAdresse } from './essen-leitung-model';

/**
 * Access to the Planungen of the Essensplanung from the Leitendenbereich
 * (`docs/essensplanung.md`, „Zugang aus dem Leitendenbereich“). A Leitende:r whose login is an
 * address of the Stamm sees the Planungen where a member has that address and opens them with a
 * second personal token of that member (`essen.leitung_link`). It gives the same access as the
 * member's link from the mail, so the Planung's page needs nothing else; the mail link keeps
 * working.
 */

/**
 * Invalidates the member's token of the Leitendenbereich, together with every new link or the
 * withdrawal: a link that got out must stop working completely. The next visit of the overview
 * creates a new one.
 */
export async function leitungLinkVergessen(db: Db, mitgliedId: number): Promise<void> {
  await db.deleteFrom('essen.leitung_link').where('mitglied_id', '=', mitgliedId).execute();
}

/**
 * Notes that a member opened the Planung, once; until then it counts as an invitation on the
 * start page of the Leitendenbereich. Two first loads at once may both try, the second is
 * ignored.
 */
export async function alsGeoeffnetMerken(db: Db, mitgliedId: number): Promise<void> {
  await sql`
    INSERT INTO essen.mitglied_geoeffnet (mitglied_id)
    SELECT ${mitgliedId}
    WHERE NOT EXISTS (SELECT 1 FROM essen.mitglied_geoeffnet WHERE mitglied_id = ${mitgliedId})
  `
    .execute(db)
    .catch((error: unknown) => {
      // Primary key violation: the other load was first
      if (getSqlErrorNumber(error) !== 2627) throw error;
    });
}

/**
 * The member the token of a Leitende:r stands for, if it is one and access was not withdrawn.
 * `ladeZugang` asks this after the personal links and before the read-only link.
 */
export async function leitungMitglied(
  db: Db,
  token: string
): Promise<{ id: number; planung_id: number; rolle: PlanungRolle; name: string } | undefined> {
  return db
    .selectFrom('essen.leitung_link as l')
    .innerJoin('essen.mitglied as m', 'm.id', 'l.mitglied_id')
    .select(['m.id', 'm.planung_id', 'm.rolle', 'm.name'])
    .where('l.token', '=', token)
    .where('m.entzogen_am', 'is', null)
    .executeTakeFirst();
}

/**
 * The Planungen of an address of the Stamm, with a token per Planung; a missing token is created
 * here. With several members of the same address in one Planung, the owner wins, then the oldest.
 * Sorted by the first day, newest first, Planungen without days on top.
 */
export async function leitungPlanungen(email: string): Promise<LeitungPlanung[]> {
  const adresse = email.trim().toLowerCase();
  if (!istStammAdresse(adresse)) return [];
  return inTransaction(async (trx) => {
    // Two pages opened at once must not both create the token of a member
    await lockResource(trx, `essen-leitung:${adresse}`);
    const rows = await trx
      .selectFrom('essen.mitglied as m')
      .innerJoin('essen.planung as p', 'p.id', 'm.planung_id')
      .leftJoin('essen.leitung_link as l', 'l.mitglied_id', 'm.id')
      .leftJoin('essen.mitglied_geoeffnet as g', 'g.mitglied_id', 'm.id')
      .select([
        'm.id',
        'm.rolle',
        'm.planung_id',
        'p.name',
        'l.token',
        'g.am as geoeffnet_am',
        (eb) =>
          eb
            .selectFrom('essen.tag as t')
            .whereRef('t.planung_id', '=', 'p.id')
            .select((tb) => tb.fn.min('t.datum').as('d'))
            .as('erster_tag'),
        (eb) =>
          eb
            .selectFrom('essen.tag as t')
            .whereRef('t.planung_id', '=', 'p.id')
            .select((tb) => tb.fn.max('t.datum').as('d'))
            .as('letzter_tag'),
      ])
      // Stored in lower case (`essen.mitglied.email`)
      .where('m.email', '=', adresse)
      .where('m.entzogen_am', 'is', null)
      .orderBy(sql`CASE WHEN m.rolle = 'besitzer' THEN 0 ELSE 1 END`)
      .orderBy('m.id')
      .execute();

    const jePlanung = new Map<number, (typeof rows)[number]>();
    for (const row of rows) if (!jePlanung.has(row.planung_id)) jePlanung.set(row.planung_id, row);

    const planungen: LeitungPlanung[] = [];
    for (const row of jePlanung.values()) {
      let token = row.token;
      if (!token) {
        token = randomBytes(32).toString('base64url');
        await trx.insertInto('essen.leitung_link').values({ mitglied_id: row.id, token }).execute();
      }
      planungen.push({
        planungId: row.planung_id,
        name: row.name,
        rolle: row.rolle,
        ersterTag: row.erster_tag ? toDateString(row.erster_tag) : null,
        letzterTag: row.letzter_tag ? toDateString(row.letzter_tag) : null,
        token,
        neu: row.geoeffnet_am === null,
      });
    }
    return planungen.sort(
      (a, b) =>
        (b.ersterTag ?? '9999').localeCompare(a.ersterTag ?? '9999') ||
        a.name.localeCompare(b.name, 'de')
    );
  });
}
