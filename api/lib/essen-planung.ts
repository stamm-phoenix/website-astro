import { sql } from 'kysely';
import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  lockResource,
  toDateString,
  toVersion,
  requireRowversion,
} from './db';
import type {
  AnlegenInput,
  BeitrittInput,
  EinladungInput,
  MahlzeitInput,
  PlanungEinstellungenInput,
  PlanungRolle,
} from './essen-planung-model';
import {
  ANFRAGE_GUELTIG_MS,
  ANFRAGEN_PRO_STUNDE,
  LINK_WARTEZEIT_MS,
  MAX_MAHLZEITEN_PRO_TAG,
  MAX_MITGLIEDER,
  MAX_TAGE,
  neuesteVersion,
} from './essen-planung-model';
import { loadEssenEinstellungen } from './essen-steuerung';
import { aendere, beginneAenderung, istWartung, protokolliereAenderung } from './essen-aendern';
import { nummeriereMahlzeiten } from './essen-mahlzeiten-reihenfolge';
import type { Zugang } from './essen-zugang';
import {
  LINK_UNGUELTIG,
  NICHT_ERLAUBT,
  PlanungError,
  WARTUNG,
  hashToken,
  isToken,
  neuesToken,
} from './essen-zugang';
import { darfPlanungAnlegen } from './essen-validation';
import { deletePlanung } from './essen-planung-loeschen';
import { belegOrdnerAufraeumen } from './essen-belege';
import { pruefeAnwesenheit, verschiebeGrenzen } from './essen-teilnehmende-grenzen';
import { leitungLinkVergessen } from './essen-leitung';
import { legePlanungAn } from './essen-planung-anlegen';
import { ValidationError } from './validation/errors';

/**
 * Planungen of the Essensplanung (`docs/essensplanung.md`): requests, members, links, settings,
 * days and meals. Access by link is in `essen-zugang.ts`, the view in `essen-ansicht.ts` and the
 * change protocol (counter and log) in `essen-aendern.ts`.
 */

// ---------------------------------------------------------------------------------------------
// Creating a Planung
// ---------------------------------------------------------------------------------------------

/**
 * Stores a request to create a Planung and returns the token for the confirmation link.
 * Refuses addresses the Steuerung does not allow and too many requests.
 */
function ANLEGEN_NICHT_ERLAUBT(): PlanungError {
  return new PlanungError(
    403,
    'ANLEGEN_NICHT_ERLAUBT',
    'Mit dieser Mailadresse kannst du gerade keine Planung anlegen. Frag beim Stamm Phoenix nach (kontakt@stamm-phoenix.de) oder lass dich von jemandem in eine bestehende Planung einladen.'
  );
}

export async function anfrageAnlegen(input: AnlegenInput, db: Db = getDb()): Promise<string> {
  const { einstellungen } = await loadEssenEinstellungen(db);
  if (einstellungen.wartung) throw WARTUNG();
  if (!darfPlanungAnlegen(input.email, einstellungen)) throw ANLEGEN_NICHT_ERLAUBT();
  // Counting and storing under one lock per address, so requests at the same time cannot all
  // slip under the limit
  return db.transaction().execute(async (trx) => {
    await lockResource(trx, `essen-anlegen:${input.email}`);
    const recent = await trx
      .selectFrom('essen.anlage_anfrage')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('email', '=', input.email)
      .where('erstellt_am', '>', new Date(Date.now() - 60 * 60_000))
      .executeTakeFirstOrThrow();
    if (Number(recent.count) >= ANFRAGEN_PRO_STUNDE) {
      throw new PlanungError(
        429,
        'ZU_VIELE_ANFRAGEN',
        'Du hast in der letzten Stunde schon mehrere Planungen angefragt. Schau in dein Postfach (auch in den Spam-Ordner) oder versuche es später noch einmal.'
      );
    }
    const token = neuesToken();
    await trx
      .insertInto('essen.anlage_anfrage')
      .values({
        token_hash: hashToken(token),
        email: input.email,
        name: input.name,
        planung_name: input.planungName,
        erster_tag: input.ersterTag,
        letzter_tag: input.letzterTag,
        laeuft_ab: new Date(Date.now() + ANFRAGE_GUELTIG_MS),
      })
      .execute();
    return token;
  });
}

/**
 * Creates the Planung of a confirmed request with its days and the template meals; the
 * requester becomes owner. Returns the owner's personal token. A second click on the same link
 * creates nothing new, it says the Planung exists.
 */
export async function anfrageBestaetigen(
  token: unknown,
  { freigabePruefen = true }: { freigabePruefen?: boolean } = {}
): Promise<string> {
  if (!isToken(token)) throw LINK_UNGUELTIG();
  return inTransaction(async (trx) => {
    // Two tabs confirming at once: the second waits here and then sees the Planung
    await lockResource(trx, `essen-anfrage:${hashToken(token)}`);
    const anfrage = await trx
      .selectFrom('essen.anlage_anfrage')
      .selectAll()
      .where('token_hash', '=', hashToken(token))
      .executeTakeFirst();
    if (!anfrage || anfrage.laeuft_ab.getTime() < Date.now()) {
      throw new PlanungError(
        404,
        'ANFRAGE_UNGUELTIG',
        'Dieser Bestätigungslink ist abgelaufen oder gilt nicht. Lege die Planung bitte noch einmal an.'
      );
    }
    if (anfrage.planung_id !== null) {
      throw new PlanungError(
        409,
        'SCHON_ANGELEGT',
        'Diese Planung ist schon angelegt. Den Link dazu hast du beim ersten Bestätigen bekommen; neue Links bekommst du unter „Meine Planungen“.'
      );
    }
    const { einstellungen } = await loadEssenEinstellungen(trx);
    if (einstellungen.wartung) throw WARTUNG();
    // The Steuerung may have closed creating for this address since the request
    if (freigabePruefen && !darfPlanungAnlegen(anfrage.email, einstellungen)) {
      throw ANLEGEN_NICHT_ERLAUBT();
    }

    const besitzerToken = neuesToken();
    const { planungId } = await legePlanungAn(
      trx,
      {
        planungName: anfrage.planung_name,
        name: anfrage.name,
        email: anfrage.email,
        ersterTag: toDateString(anfrage.erster_tag),
        letzterTag: toDateString(anfrage.letzter_tag),
        tokenHash: hashToken(besitzerToken),
      },
      einstellungen
    );
    await trx
      .updateTable('essen.anlage_anfrage')
      .set({ planung_id: planungId })
      .where('id', '=', anfrage.id)
      .execute();
    return besitzerToken;
  });
}

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

// ---------------------------------------------------------------------------------------------
// The Planung, its days and meals
// ---------------------------------------------------------------------------------------------

/**
 * Renames the Planung and sets whether editors manage members (owners). Without a version
 * check: every change bumps the Planung's own row, and the last owner's choice wins.
 */
export async function planungAendern(
  zugang: Zugang,
  input: PlanungEinstellungenInput
): Promise<void> {
  await aendere(
    zugang,
    'planung-geaendert',
    async (trx) => {
      // The Planung is locked by `aendere`; a field changed by someone else since the form was
      // filled is a conflict, fields left alone keep what others saved
      const vorher = await trx
        .selectFrom('essen.planung')
        .select(['name', 'mitglieder_verwalten'])
        .where('id', '=', zugang.planungId)
        .executeTakeFirstOrThrow();
      if (
        (input.name?.vorher !== undefined && input.name.vorher !== vorher.name) ||
        (input.mitgliederVerwalten?.vorher !== undefined &&
          input.mitgliederVerwalten.vorher !== vorher.mitglieder_verwalten)
      ) {
        throw new VersionConflictError();
      }
      await trx
        .updateTable('essen.planung')
        .set({
          ...(input.name ? { name: input.name.neu } : {}),
          ...(input.mitgliederVerwalten
            ? { mitglieder_verwalten: input.mitgliederVerwalten.neu }
            : {}),
        })
        .where('id', '=', zugang.planungId)
        .execute();
      return { result: undefined, details: { name: input.name?.neu ?? vorher.name } };
    },
    { recht: 'besitzer' }
  );
}

/** Deletes the Planung with everything in it (owners). */
export async function planungLoeschen(zugang: Zugang): Promise<void> {
  if (zugang.zugang !== 'besitzer') throw NICHT_ERLAUBT();
  await inTransaction(async (trx) => {
    if (await istWartung(trx)) throw WARTUNG();
    // Locked like a change in `aendere`, so a role taken away meanwhile is seen below
    await sql`SELECT id FROM essen.planung WITH (UPDLOCK, HOLDLOCK) WHERE id = ${zugang.planungId}`.execute(
      trx
    );
    const mitglied = await trx
      .selectFrom('essen.mitglied')
      .select(['rolle', 'entzogen_am'])
      .where('id', '=', zugang.mitgliedId!)
      .executeTakeFirst();
    if (!mitglied || mitglied.entzogen_am || mitglied.rolle !== 'besitzer') throw NICHT_ERLAUBT();
    await deletePlanung(trx, zugang.planungId);
  });
  // Photos only after the commit; what fails is tried again later
  await belegOrdnerAufraeumen();
}

async function tagDerPlanung(trx: Db, zugang: Zugang, tagId: number) {
  const tag = await trx
    .selectFrom('essen.tag')
    .selectAll()
    .where('id', '=', tagId)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!tag) throw new RecordNotFoundError();
  return tag;
}

const TAG_GIBT_ES = () =>
  new ValidationError({ datum: 'Diesen Tag gibt es in der Planung schon.' });

export async function tagHinzufuegen(zugang: Zugang, datum: string): Promise<void> {
  await aendere(zugang, 'tag-neu', async (trx) => {
    const tage = await trx
      .selectFrom('essen.tag')
      .select('datum')
      .where('planung_id', '=', zugang.planungId)
      .execute();
    if (tage.some((tag) => toDateString(tag.datum) === datum)) throw TAG_GIBT_ES();
    if (tage.length >= MAX_TAGE) {
      throw new ValidationError({ datum: `Eine Planung hat höchstens ${MAX_TAGE} Tage.` });
    }
    const tag = await trx
      .insertInto('essen.tag')
      .values({ planung_id: zugang.planungId, datum })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    const { einstellungen } = await loadEssenEinstellungen(trx);
    if (einstellungen.vorlageMahlzeiten.length) {
      await trx
        .insertInto('essen.mahlzeit')
        .values(
          einstellungen.vorlageMahlzeiten.map((name, position) => ({
            tag_id: tag.id,
            position: position + 1,
            name,
          }))
        )
        .execute();
    }
    return { result: undefined, details: { datum } };
  });
}

export async function tagVerschieben(
  zugang: Zugang,
  tagId: number,
  datum: string,
  etag: string
): Promise<void> {
  await aendere(zugang, 'tag-geaendert', async (trx) => {
    const tag = await tagDerPlanung(trx, zugang, tagId);
    const doppelt = await trx
      .selectFrom('essen.tag')
      .select('id')
      .where('planung_id', '=', zugang.planungId)
      .where('datum', '=', datum)
      .where('id', '<>', tagId)
      .executeTakeFirst();
    if (doppelt) throw TAG_GIBT_ES();
    const result = await trx
      .updateTable('essen.tag')
      .set({ datum })
      .where('id', '=', tagId)
      .where('version', '=', requireRowversion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    await pruefeAnwesenheit(trx, zugang.planungId);
    return { result: undefined, details: { datum, vorher: toDateString(tag.datum) } };
  });
}

export async function tagLoeschen(zugang: Zugang, tagId: number, etag: string): Promise<void> {
  await aendere(zugang, 'tag-geloescht', async (trx) => {
    const tag = await tagDerPlanung(trx, zugang, tagId);
    // `etag` is the `tagStand`: a meal or a planned dish changed meanwhile is a conflict
    const teile = await trx
      .selectFrom('essen.mahlzeit as m')
      .leftJoin('essen.einplanung as e', 'e.mahlzeit_id', 'm.id')
      .select(['m.id as mahlzeit_id', 'm.version as mahlzeit', 'e.version as einplanung'])
      .where('m.tag_id', '=', tagId)
      .execute();
    const stand = neuesteVersion([
      toVersion(tag.version),
      ...teile.flatMap((teil) => [
        toVersion(teil.mahlzeit),
        ...(teil.einplanung ? [toVersion(teil.einplanung)] : []),
      ]),
    ]);
    if (stand !== etag.trim()) throw new VersionConflictError();
    await verschiebeGrenzen(trx, zugang.planungId, [
      ...new Set(teile.map((teil) => teil.mahlzeit_id)),
    ]);
    const result = await trx
      .deleteFrom('essen.tag')
      .where('id', '=', tagId)
      .where('version', '=', tag.version)
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { datum: toDateString(tag.datum) } };
  });
}

export async function mahlzeitHinzufuegen(
  zugang: Zugang,
  tagId: number,
  input: MahlzeitInput,
  position?: number
): Promise<void> {
  await aendere(zugang, 'mahlzeit-neu', async (trx) => {
    const tag = await tagDerPlanung(trx, zugang, tagId);
    const anzahl = await trx
      .selectFrom('essen.mahlzeit')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('tag_id', '=', tagId)
      .executeTakeFirstOrThrow();
    if (Number(anzahl.count) >= MAX_MAHLZEITEN_PRO_TAG) {
      throw new ValidationError({
        name: `Ein Tag hat höchstens ${MAX_MAHLZEITEN_PRO_TAG} Mahlzeiten.`,
      });
    }
    const mahlzeit = await trx
      .insertInto('essen.mahlzeit')
      .values({
        tag_id: tagId,
        position: Number(anzahl.count) + 1,
        name: input.name,
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    if (position !== undefined) {
      await nummeriereMahlzeiten(trx, tagId, { id: mahlzeit.id, position });
    }
    return { result: undefined, details: { name: input.name, datum: toDateString(tag.datum) } };
  });
}

async function mahlzeitDerPlanung(trx: Db, zugang: Zugang, mahlzeitId: number) {
  const mahlzeit = await trx
    .selectFrom('essen.mahlzeit as m')
    .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
    .select(['m.id', 'm.version', 'm.tag_id', 'm.name', 't.datum'])
    .where('m.id', '=', mahlzeitId)
    .where('t.planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!mahlzeit) throw new RecordNotFoundError();
  return mahlzeit;
}

export async function mahlzeitAendern(
  zugang: Zugang,
  mahlzeitId: number,
  input: MahlzeitInput & { position?: number },
  etag: string
): Promise<void> {
  await aendere(zugang, 'mahlzeit-geaendert', async (trx) => {
    const mahlzeit = await mahlzeitDerPlanung(trx, zugang, mahlzeitId);
    const result = await trx
      .updateTable('essen.mahlzeit')
      .set({ name: input.name })
      .where('id', '=', mahlzeitId)
      .where('version', '=', requireRowversion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    if (input.position !== undefined) {
      await nummeriereMahlzeiten(trx, mahlzeit.tag_id, {
        id: mahlzeitId,
        position: input.position,
      });
      await pruefeAnwesenheit(trx, zugang.planungId);
    }
    return {
      result: undefined,
      details: {
        name: input.name,
        ...(mahlzeit.name !== input.name ? { vorher: mahlzeit.name } : {}),
        datum: toDateString(mahlzeit.datum),
      },
    };
  });
}

export async function mahlzeitLoeschen(
  zugang: Zugang,
  mahlzeitId: number,
  etag: string
): Promise<void> {
  await aendere(zugang, 'mahlzeit-geloescht', async (trx) => {
    const mahlzeit = await mahlzeitDerPlanung(trx, zugang, mahlzeitId);
    // `etag` is the `mahlzeitStand`: a dish planned or changed meanwhile is a conflict
    const einplanungen = await trx
      .selectFrom('essen.einplanung')
      .select('version')
      .where('mahlzeit_id', '=', mahlzeitId)
      .execute();
    const stand = neuesteVersion([
      toVersion(mahlzeit.version),
      ...einplanungen.map((einplanung) => toVersion(einplanung.version)),
    ]);
    if (stand !== etag.trim()) throw new VersionConflictError();
    await verschiebeGrenzen(trx, zugang.planungId, [mahlzeitId]);
    const result = await trx
      .deleteFrom('essen.mahlzeit')
      .where('id', '=', mahlzeitId)
      .where('version', '=', mahlzeit.version)
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    // Close the gap in the order
    await nummeriereMahlzeiten(trx, mahlzeit.tag_id);
    return {
      result: undefined,
      details: { name: mahlzeit.name, datum: toDateString(mahlzeit.datum) },
    };
  });
}
