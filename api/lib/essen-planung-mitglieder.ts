import { sql } from 'kysely';
import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  requireRowversion,
} from './db';
import type { BeitrittInput, EinladungInput, PlanungRolle } from './essen-planung-model';
import { LINK_WARTEZEIT_MS, MAX_MITGLIEDER } from './essen-planung-model';
import { aendere, beginneAenderung, protokolliereAenderung } from './essen-aendern';
import type { Zugang } from './essen-zugang';
import {
  LINK_UNGUELTIG,
  NICHT_ERLAUBT,
  PlanungError,
  hashToken,
  isToken,
  neuesToken,
} from './essen-zugang';
import { leitungLinkVergessen } from './essen-leitung';
import { ValidationError } from './validation/errors';

// ---------------------------------------------------------------------------------------------
// Links and members
// ---------------------------------------------------------------------------------------------

export interface LinkFuerMail {
  mitgliedId: number;
  name: string;
  email: string;
  planungName: string;
  token: string;
  /** The link before, put back by `linkZuruecknehmen` when the mail did not go out. */
  vorher: { tokenHash: string | null; linkGesendetAm: Date | null };
}

/**
 * Undoes a new link whose mail failed: the old link works again and a new attempt is allowed at
 * once. Leaves the member alone if the link changed again in between.
 */
export async function linkZuruecknehmen(link: LinkFuerMail): Promise<void> {
  await getDb()
    .updateTable('essen.mitglied')
    .set({
      ...(link.vorher.tokenHash ? { token_hash: link.vorher.tokenHash } : {}),
      link_gesendet_am: link.vorher.linkGesendetAm,
    })
    .where('id', '=', link.mitgliedId)
    .where('token_hash', '=', hashToken(link.token))
    .execute();
}

/**
 * New personal links for all Planungen an address is a member of, for „Meine Planungen“. The
 * old links stop working. Members who got a link in the last minutes are left out.
 */
export async function neueLinksFuerAdresse(email: string): Promise<LinkFuerMail[]> {
  return inTransaction(async (trx) => {
    const rows = await trx
      .selectFrom('essen.mitglied as m')
      .innerJoin('essen.planung as p', 'p.id', 'm.planung_id')
      .select(['m.id', 'm.name', 'm.token_hash', 'm.link_gesendet_am', 'p.name as planung_name'])
      .where('m.email', '=', email)
      .where('m.entzogen_am', 'is', null)
      .execute();
    const links: LinkFuerMail[] = [];
    for (const row of rows) {
      if (row.link_gesendet_am && Date.now() - row.link_gesendet_am.getTime() < LINK_WARTEZEIT_MS) {
        continue;
      }
      const token = neuesToken();
      // Only if nobody renewed the link meanwhile, so two requests at once send one link
      const result = await trx
        .updateTable('essen.mitglied')
        .set({ token_hash: hashToken(token), link_gesendet_am: sql<Date>`SYSUTCDATETIME()` })
        .where('id', '=', row.id)
        .where('token_hash', '=', row.token_hash!)
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) continue;
      await leitungLinkVergessen(trx, row.id);
      links.push({
        mitgliedId: row.id,
        name: row.name,
        email,
        planungName: row.planung_name,
        token,
        vorher: { tokenHash: row.token_hash, linkGesendetAm: row.link_gesendet_am },
      });
    }
    return links;
  });
}

async function zaehleMitglieder(trx: Db, planungId: number): Promise<number> {
  const row = await trx
    .selectFrom('essen.mitglied')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('planung_id', '=', planungId)
    .where('entzogen_am', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

const ZU_VIELE_MITGLIEDER = () =>
  new ValidationError({
    name: `Eine Planung hat höchstens ${MAX_MITGLIEDER} Mitglieder. Entziehe zuerst jemandem den Zugang, der nicht mehr mitplant.`,
  });

/** Invites someone by mail; returns the new member's token for the invitation. */
export async function einladen(zugang: Zugang, input: EinladungInput): Promise<LinkFuerMail> {
  return aendere(
    zugang,
    'mitglied-eingeladen',
    async (trx, aktuell) => {
      if (input.rolle === 'besitzer' && aktuell.zugang !== 'besitzer') throw NICHT_ERLAUBT();
      if ((await zaehleMitglieder(trx, zugang.planungId)) >= MAX_MITGLIEDER) {
        throw ZU_VIELE_MITGLIEDER();
      }
      const vorhanden = await trx
        .selectFrom('essen.mitglied')
        .select('id')
        .where('planung_id', '=', zugang.planungId)
        .where('email', '=', input.email)
        .where('entzogen_am', 'is', null)
        .executeTakeFirst();
      if (vorhanden) {
        throw new ValidationError({
          email:
            'Diese Adresse ist schon Mitglied. Unter „Neuen Link schicken“ bekommt sie ihren Link noch einmal.',
        });
      }
      const token = neuesToken();
      const mitglied = await trx
        .insertInto('essen.mitglied')
        .values({
          planung_id: zugang.planungId,
          name: input.name,
          email: input.email,
          rolle: input.rolle,
          token_hash: hashToken(token),
          link_gesendet_am: sql<Date>`SYSUTCDATETIME()`,
        })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      const planung = await trx
        .selectFrom('essen.planung')
        .select('name')
        .where('id', '=', zugang.planungId)
        .executeTakeFirstOrThrow();
      return {
        result: {
          mitgliedId: mitglied.id,
          name: input.name,
          email: input.email,
          planungName: planung.name,
          token,
          vorher: { tokenHash: null, linkGesendetAm: null },
        },
        details: { name: input.name, rolle: input.rolle },
      };
    },
    { recht: 'verwalten' }
  );
}

/** A new link for a member (the old one stops working), to send by mail. */
export async function neuerLink(zugang: Zugang, mitgliedId: number): Promise<LinkFuerMail> {
  return aendere(
    zugang,
    'mitglied-link',
    async (trx, aktuell) => {
      const row = await trx
        .selectFrom('essen.mitglied as m')
        .innerJoin('essen.planung as p', 'p.id', 'm.planung_id')
        .select([
          'm.id',
          'm.name',
          'm.email',
          'm.rolle',
          'm.entzogen_am',
          'm.token_hash',
          'm.link_gesendet_am',
          'p.name as planung_name',
        ])
        .where('m.id', '=', mitgliedId)
        .where('m.planung_id', '=', zugang.planungId)
        .executeTakeFirst();
      if (!row || row.entzogen_am) throw new RecordNotFoundError();
      if (!row.email) {
        throw new ValidationError({
          email: 'Für dieses Mitglied ist keine Mailadresse hinterlegt.',
        });
      }
      if (row.rolle === 'besitzer' && aktuell.zugang !== 'besitzer') throw NICHT_ERLAUBT();
      if (row.link_gesendet_am && Date.now() - row.link_gesendet_am.getTime() < LINK_WARTEZEIT_MS) {
        throw new PlanungError(
          429,
          'ZU_VIELE_ANFRAGEN',
          'An dieses Mitglied ging gerade erst ein Link. Bitte warte ein paar Minuten.'
        );
      }
      const token = neuesToken();
      const result = await trx
        .updateTable('essen.mitglied')
        .set({ token_hash: hashToken(token), link_gesendet_am: sql<Date>`SYSUTCDATETIME()` })
        .where('id', '=', mitgliedId)
        .where('token_hash', '=', row.token_hash!)
        .executeTakeFirst();
      // „Meine Planungen“ renewed it at the same moment
      if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
      await leitungLinkVergessen(trx, mitgliedId);
      return {
        result: {
          mitgliedId,
          name: row.name,
          email: row.email,
          planungName: row.planung_name,
          token,
          vorher: { tokenHash: row.token_hash, linkGesendetAm: row.link_gesendet_am },
        },
        details: { name: row.name },
      };
    },
    { recht: 'verwalten' }
  );
}

/** Joins over the shared link; returns the new member's personal token. */
export async function beitreten(beitrittToken: unknown, input: BeitrittInput): Promise<string> {
  if (!isToken(beitrittToken)) throw LINK_UNGUELTIG();
  const planung = await getDb()
    .selectFrom('essen.planung')
    .select('id')
    .where('beitritt_token', '=', beitrittToken)
    .executeTakeFirst();
  if (!planung) throw LINK_UNGUELTIG();
  const token = neuesToken();
  // A new member joins by itself; the change is logged under its own name
  await inTransaction(async (trx) => {
    const bumped = await beginneAenderung(trx, planung.id);
    if (bumped.beitrittToken !== beitrittToken) throw LINK_UNGUELTIG();
    if ((await zaehleMitglieder(trx, planung.id)) >= MAX_MITGLIEDER) throw ZU_VIELE_MITGLIEDER();
    const mitglied = await trx
      .insertInto('essen.mitglied')
      .values({
        planung_id: planung.id,
        name: input.name,
        email: input.email,
        rolle: 'bearbeiten',
        token_hash: hashToken(token),
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    await protokolliereAenderung(trx, planung.id, bumped.seq, mitglied.id, 'mitglied-beigetreten', {
      name: input.name,
    });
  });
  return token;
}

/** The name of the Planung behind a shared join link, for the join page. */
export async function beitrittAnsehen(beitrittToken: unknown): Promise<{ name: string }> {
  if (!isToken(beitrittToken)) throw LINK_UNGUELTIG();
  const planung = await getDb()
    .selectFrom('essen.planung')
    .select('name')
    .where('beitritt_token', '=', beitrittToken)
    .executeTakeFirst();
  if (!planung) throw LINK_UNGUELTIG();
  return planung;
}

/** Changes the role of a member or removes its access (owners only for owners). */
export async function mitgliedAendern(
  zugang: Zugang,
  mitgliedId: number,
  aenderung: { rolle: PlanungRolle } | { entziehen: true },
  etag: string
): Promise<void> {
  const aktion = 'entziehen' in aenderung ? 'mitglied-entzogen' : 'mitglied-geaendert';
  await aendere(
    zugang,
    aktion,
    async (trx, aktuell) => {
      const row = await trx
        .selectFrom('essen.mitglied')
        .select(['id', 'name', 'rolle', 'entzogen_am'])
        .where('id', '=', mitgliedId)
        .where('planung_id', '=', zugang.planungId)
        .executeTakeFirst();
      if (!row || row.entzogen_am) throw new RecordNotFoundError();
      const betrifftBesitzer = row.rolle === 'besitzer' || 'rolle' in aenderung;
      if (betrifftBesitzer && aktuell.zugang !== 'besitzer') throw NICHT_ERLAUBT();
      if (row.rolle === 'besitzer' && !('rolle' in aenderung && aenderung.rolle === 'besitzer')) {
        const besitzer = await trx
          .selectFrom('essen.mitglied')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('planung_id', '=', zugang.planungId)
          .where('rolle', '=', 'besitzer')
          .where('entzogen_am', 'is', null)
          .executeTakeFirstOrThrow();
        if (Number(besitzer.count) <= 1) {
          throw new ValidationError({
            rolle:
              'Eine Planung braucht mindestens eine Besitzer:in. Mach zuerst jemand anderen zur Besitzer:in.',
          });
        }
      }
      const result = await trx
        .updateTable('essen.mitglied')
        .set(
          'entziehen' in aenderung
            ? { entzogen_am: sql<Date>`SYSUTCDATETIME()`, token_hash: null }
            : { rolle: aenderung.rolle }
        )
        .where('id', '=', mitgliedId)
        .where('version', '=', requireRowversion(etag))
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
      if ('entziehen' in aenderung) {
        await leitungLinkVergessen(trx, mitgliedId);
      }
      return {
        result: undefined,
        details: { name: row.name, ...('rolle' in aenderung ? { rolle: aenderung.rolle } : {}) },
      };
    },
    { recht: 'verwalten' }
  );
}

/** Changes one's own name. */
export async function eigenenNamenAendern(zugang: Zugang, name: string): Promise<void> {
  await aendere(zugang, 'name-geaendert', async (trx) => {
    const before = await trx
      .selectFrom('essen.mitglied')
      .select('name')
      .where('id', '=', zugang.mitgliedId!)
      .executeTakeFirstOrThrow();
    await trx
      .updateTable('essen.mitglied')
      .set({ name })
      .where('id', '=', zugang.mitgliedId!)
      .execute();
    return { result: undefined, details: { name, vorher: before.name } };
  });
}

/** Creates a new shared link (the old one stops working) or switches it off. */
export async function gemeinsamerLink(
  zugang: Zugang,
  art: 'beitritt' | 'lesen',
  an: boolean
): Promise<void> {
  await aendere(
    zugang,
    art === 'beitritt' ? 'link-beitritt' : 'link-lesen',
    async (trx) => {
      await trx
        .updateTable('essen.planung')
        .set(
          art === 'beitritt'
            ? { beitritt_token: an ? neuesToken() : null }
            : { lese_token: an ? neuesToken() : null }
        )
        .where('id', '=', zugang.planungId)
        .execute();
      return { result: undefined, details: { an } };
    },
    { recht: 'verwalten' }
  );
}
