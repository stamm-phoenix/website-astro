import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  lockResource,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type {
  AnlegenInput,
  BeitrittInput,
  EinladungInput,
  MahlzeitInput,
  PlanungAenderung,
  PlanungAnsicht,
  PlanungEinstellungenInput,
  PlanungMitglied,
  PlanungRolle,
  PlanungZugang,
} from './essen-planung-model';
import {
  ANFRAGE_GUELTIG_MS,
  ANFRAGEN_PRO_STUNDE,
  LINK_WARTEZEIT_MS,
  MAX_MAHLZEITEN_PRO_TAG,
  MAX_MITGLIEDER,
  MAX_TAGE,
  addDays,
  daysBetween,
  darfBearbeiten,
  darfMitgliederVerwalten,
  loeschDatum,
  nummeriereTage,
} from './essen-planung-model';
import { loadEssenEinstellungen } from './essen-steuerung';
import { darfPlanungAnlegen } from './essen-validation';
import { deletePlanung } from './essen-planung-loeschen';
import { ValidationError } from './pflege-validation';

/**
 * Planungen of the Essensplanung (`docs/essensplanung.md`): access by link, the view a page
 * shows, and every change. Each change bumps `essen.planung.aenderung_seq` in the same
 * transaction, which also serializes the changes of one Planung, and is logged in
 * `essen.aenderung`; the pages poll the counter.
 */

/** A request the link does not allow, or a rule of the Planung; the endpoint answers with it. */
export class PlanungError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'PlanungError';
  }
}

export const LINK_UNGUELTIG = () =>
  new PlanungError(
    404,
    'LINK_UNGUELTIG',
    'Dieser Link gilt nicht (mehr). Vielleicht wurde er durch einen neuen ersetzt oder der Zugang entzogen. Neue Links bekommst du auf der Seite „Essensplanung“ unter „Meine Planungen“.'
  );

const NUR_LESEN = () =>
  new PlanungError(403, 'NUR_LESEN', 'Mit diesem Link kannst du die Planung nur ansehen.');

const NICHT_ERLAUBT = () =>
  new PlanungError(
    403,
    'NICHT_ERLAUBT',
    'Das dürfen nur die Besitzer:innen der Planung (oder, wenn sie es erlauben, alle Bearbeitenden).'
  );

const WARTUNG = () =>
  new PlanungError(
    503,
    'MAINTENANCE',
    'Die Essensplanung wird gerade gewartet. Ansehen geht, Änderungen bitte etwas später noch einmal.'
  );

/** 32 random bytes, base64url: the secret part of every link. */
export function neuesToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Whether a string can be a token at all; anything else never reaches the database. */
export function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export interface Zugang {
  planungId: number;
  zugang: PlanungZugang;
  mitgliedId: number | null;
  name: string;
}

/** The access a token gives: a member's own link, or the shared read-only link. */
export async function ladeZugang(token: unknown, db: Db = getDb()): Promise<Zugang> {
  if (!isToken(token)) throw LINK_UNGUELTIG();
  const mitglied = await db
    .selectFrom('essen.mitglied')
    .select(['id', 'planung_id', 'rolle', 'name'])
    .where('token_hash', '=', hashToken(token))
    .where('entzogen_am', 'is', null)
    .executeTakeFirst();
  if (mitglied) {
    return {
      planungId: mitglied.planung_id,
      zugang: mitglied.rolle,
      mitgliedId: mitglied.id,
      name: mitglied.name,
    };
  }
  const planung = await db
    .selectFrom('essen.planung')
    .select('id')
    .where('lese_token', '=', token)
    .executeTakeFirst();
  if (planung) return { planungId: planung.id, zugang: 'lesen', mitgliedId: null, name: '' };
  throw LINK_UNGUELTIG();
}

async function istWartung(db: Db): Promise<boolean> {
  return (await loadEssenEinstellungen(db)).einstellungen.wartung;
}

const AENDERUNGEN_ANZEIGEN = 30;

/** The view of a Planung for the given access. */
export async function ladeAnsicht(zugang: Zugang, db: Db = getDb()): Promise<PlanungAnsicht> {
  const { seq, stand, stored } = await standUndEinstellungen(zugang, db);
  const [planung, mitglieder, tage, mahlzeiten, aenderungen] = await Promise.all([
    db
      .selectFrom('essen.planung')
      .selectAll()
      .where('id', '=', zugang.planungId)
      .executeTakeFirst(),
    db
      .selectFrom('essen.mitglied')
      .selectAll()
      .where('planung_id', '=', zugang.planungId)
      .orderBy('id')
      .execute(),
    db.selectFrom('essen.tag').selectAll().where('planung_id', '=', zugang.planungId).execute(),
    db
      .selectFrom('essen.mahlzeit as m')
      .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
      .select(['m.id', 'm.version', 'm.tag_id', 'm.position', 'm.name', 'm.uhrzeit'])
      .where('t.planung_id', '=', zugang.planungId)
      .execute(),
    db
      .selectFrom('essen.aenderung')
      .selectAll()
      .where('planung_id', '=', zugang.planungId)
      .orderBy('seq', 'desc')
      .top(AENDERUNGEN_ANZEIGEN)
      .execute(),
  ]);
  if (!planung) throw LINK_UNGUELTIG();

  const verwalten = darfMitgliederVerwalten(zugang.zugang, planung.mitglieder_verwalten);
  const namen = new Map(mitglieder.map((mitglied) => [mitglied.id, mitglied.name]));
  const nummerierteTage = nummeriereTage(
    tage.map((tag) => ({
      id: tag.id,
      etag: toVersion(tag.version),
      datum: toDateString(tag.datum),
    })),
    mahlzeiten.map((mahlzeit) => ({
      id: mahlzeit.id,
      etag: toVersion(mahlzeit.version),
      tagId: mahlzeit.tag_id,
      position: mahlzeit.position,
      name: mahlzeit.name,
      uhrzeit: mahlzeit.uhrzeit,
    }))
  );
  const letzterTag = nummerierteTage.at(-1)?.datum;
  return {
    id: planung.id,
    etag: toVersion(planung.version),
    name: planung.name,
    seq,
    stand,
    zugang: zugang.zugang,
    ichId: zugang.mitgliedId,
    darfVerwalten: verwalten,
    mitgliederVerwalten: planung.mitglieder_verwalten,
    links: verwalten ? { beitritt: planung.beitritt_token, lesen: planung.lese_token } : null,
    tage: nummerierteTage,
    mitglieder: mitglieder
      // The read-only link sees no members; removed ones only those who manage
      .filter((mitglied) => zugang.zugang !== 'lesen' && (verwalten || !mitglied.entzogen_am))
      .map((mitglied): PlanungMitglied => ({
        id: mitglied.id,
        etag: toVersion(mitglied.version),
        name: mitglied.name,
        rolle: mitglied.rolle,
        email: verwalten || mitglied.id === zugang.mitgliedId ? mitglied.email : null,
        entzogen: mitglied.entzogen_am !== null,
        ich: mitglied.id === zugang.mitgliedId,
      })),
    // Without days the day it was created counts, as in the retention run
    loeschtAm: loeschDatum(
      letzterTag ?? planung.erstellt_am.toISOString().slice(0, 10),
      stored.einstellungen.aufbewahrungMonate
    ),
    wartung: stored.einstellungen.wartung,
    aenderungen: aenderungen.map((row): PlanungAenderung => ({
      seq: Number(row.seq),
      at: row.at.toISOString(),
      wer: row.mitglied_id === null ? '' : (namen.get(row.mitglied_id) ?? ''),
      aktion: row.aktion,
      details: JSON.parse(row.details) as Record<string, unknown>,
    })),
  };
}

/** The change counter of a Planung, for the pages that poll it. */
export async function ladeStand(zugang: Zugang, db: Db = getDb()): Promise<string> {
  return (await standUndEinstellungen(zugang, db)).stand;
}

/**
 * The counter of the Planung and the settings of the Steuerung, read before anything else: a
 * change committed later has a higher counter or a new settings version, so the next poll loads
 * the view again instead of keeping a mix of old and new rows.
 */
async function standUndEinstellungen(zugang: Zugang, db: Db) {
  const [row, stored] = await Promise.all([
    db
      .selectFrom('essen.planung')
      .select('aenderung_seq')
      .where('id', '=', zugang.planungId)
      .executeTakeFirst(),
    loadEssenEinstellungen(db),
  ]);
  if (!row) throw LINK_UNGUELTIG();
  const seq = Number(row.aenderung_seq);
  return { seq, stand: `${seq}.${stored.etag.replace(/\W/g, '')}`, stored };
}

interface AendernOptionen {
  /** Who may do it: edit (default), manage members, or only owners. */
  recht?: 'bearbeiten' | 'verwalten' | 'besitzer';
}

/**
 * Runs a change of a Planung in one transaction: checks the access and the maintenance mode,
 * bumps the change counter (which locks the Planung until the end) and logs the change.
 */
export async function aendere<T>(
  zugang: Zugang,
  aktion: string,
  /** Gets the access as checked in the transaction, with the member's current role. */
  work: (trx: Db, aktuell: Zugang) => Promise<{ result: T; details: Record<string, unknown> }>,
  { recht = 'bearbeiten' }: AendernOptionen = {}
): Promise<T> {
  if (!darfBearbeiten(zugang.zugang)) throw NUR_LESEN();
  return inTransaction(async (trx) => {
    if (await istWartung(trx)) throw WARTUNG();
    const bumped = await trx
      .updateTable('essen.planung')
      .set({
        aenderung_seq: sql<string>`aenderung_seq + 1`,
        geaendert_am: sql<Date>`SYSUTCDATETIME()`,
      })
      .output(['inserted.aenderung_seq', 'inserted.mitglieder_verwalten'])
      .where('id', '=', zugang.planungId)
      .executeTakeFirst();
    if (!bumped) throw LINK_UNGUELTIG();
    // The member may have lost access or the role since the link was read
    if (zugang.mitgliedId !== null) {
      const mitglied = await trx
        .selectFrom('essen.mitglied')
        .select(['rolle', 'entzogen_am'])
        .where('id', '=', zugang.mitgliedId)
        .executeTakeFirst();
      if (!mitglied || mitglied.entzogen_am) throw LINK_UNGUELTIG();
      zugang = { ...zugang, zugang: mitglied.rolle };
    }
    if (recht === 'besitzer' && zugang.zugang !== 'besitzer') throw NICHT_ERLAUBT();
    if (
      recht === 'verwalten' &&
      !darfMitgliederVerwalten(zugang.zugang, bumped.mitglieder_verwalten)
    ) {
      throw NICHT_ERLAUBT();
    }
    const { result, details } = await work(trx, zugang);
    await trx
      .insertInto('essen.aenderung')
      .values({
        planung_id: zugang.planungId,
        seq: bumped.aenderung_seq,
        mitglied_id: zugang.mitgliedId,
        aktion,
        details: JSON.stringify(details),
      })
      .execute();
    return result;
  });
}

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

    const planung = await trx
      .insertInto('essen.planung')
      .values({ name: anfrage.planung_name })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    const besitzerToken = neuesToken();
    const besitzer = await trx
      .insertInto('essen.mitglied')
      .values({
        planung_id: planung.id,
        name: anfrage.name,
        email: anfrage.email,
        rolle: 'besitzer',
        token_hash: hashToken(besitzerToken),
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    const erster = toDateString(anfrage.erster_tag);
    const anzahl = Math.min(daysBetween(erster, toDateString(anfrage.letzter_tag)) + 1, MAX_TAGE);
    for (let index = 0; index < anzahl; index++) {
      const tag = await trx
        .insertInto('essen.tag')
        .values({ planung_id: planung.id, datum: addDays(erster, index) })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
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
    }
    await trx
      .updateTable('essen.anlage_anfrage')
      .set({ planung_id: planung.id })
      .where('id', '=', anfrage.id)
      .execute();
    await trx
      .updateTable('essen.planung')
      .set({ aenderung_seq: '1' })
      .where('id', '=', planung.id)
      .execute();
    await trx
      .insertInto('essen.aenderung')
      .values({
        planung_id: planung.id,
        seq: 1,
        mitglied_id: besitzer.id,
        aktion: 'planung-angelegt',
        details: JSON.stringify({ name: anfrage.planung_name }),
      })
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
  new ValidationError({ name: `Eine Planung hat höchstens ${MAX_MITGLIEDER} Mitglieder.` });

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
    if (await istWartung(trx)) throw WARTUNG();
    const bumped = await trx
      .updateTable('essen.planung')
      .set({
        aenderung_seq: sql<string>`aenderung_seq + 1`,
        geaendert_am: sql<Date>`SYSUTCDATETIME()`,
      })
      .output(['inserted.aenderung_seq', 'inserted.beitritt_token'])
      .where('id', '=', planung.id)
      .executeTakeFirstOrThrow();
    if (bumped.beitritt_token !== beitrittToken) throw LINK_UNGUELTIG();
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
    await trx
      .insertInto('essen.aenderung')
      .values({
        planung_id: planung.id,
        seq: bumped.aenderung_seq,
        mitglied_id: mitglied.id,
        aktion: 'mitglied-beigetreten',
        details: JSON.stringify({ name: input.name }),
      })
      .execute();
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
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
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
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { datum, vorher: toDateString(tag.datum) } };
  });
}

export async function tagLoeschen(zugang: Zugang, tagId: number, etag: string): Promise<void> {
  await aendere(zugang, 'tag-geloescht', async (trx) => {
    const tag = await tagDerPlanung(trx, zugang, tagId);
    const result = await trx
      .deleteFrom('essen.tag')
      .where('id', '=', tagId)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { datum: toDateString(tag.datum) } };
  });
}

/** Moves a meal to `position` (1-based) within its day and renumbers the others. */
async function sortiere(
  trx: Db,
  tagId: number,
  mahlzeitId: number,
  position: number
): Promise<void> {
  const mahlzeiten = await trx
    .selectFrom('essen.mahlzeit')
    .select(['id', 'position'])
    .where('tag_id', '=', tagId)
    .orderBy('position')
    .orderBy('id')
    .execute();
  const ohne = mahlzeiten.filter((mahlzeit) => mahlzeit.id !== mahlzeitId).map((m) => m.id);
  ohne.splice(Math.min(Math.max(position - 1, 0), ohne.length), 0, mahlzeitId);
  for (const [index, id] of ohne.entries()) {
    const current = mahlzeiten.find((mahlzeit) => mahlzeit.id === id);
    if (current?.position !== index + 1) {
      await trx
        .updateTable('essen.mahlzeit')
        .set({ position: index + 1 })
        .where('id', '=', id)
        .execute();
    }
  }
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
        uhrzeit: input.uhrzeit,
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    if (position !== undefined) await sortiere(trx, tagId, mahlzeit.id, position);
    return { result: undefined, details: { name: input.name, datum: toDateString(tag.datum) } };
  });
}

async function mahlzeitDerPlanung(trx: Db, zugang: Zugang, mahlzeitId: number) {
  const mahlzeit = await trx
    .selectFrom('essen.mahlzeit as m')
    .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
    .select(['m.id', 'm.tag_id', 'm.name', 't.datum'])
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
      .set({ name: input.name, uhrzeit: input.uhrzeit })
      .where('id', '=', mahlzeitId)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    if (input.position !== undefined)
      await sortiere(trx, mahlzeit.tag_id, mahlzeitId, input.position);
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
    const result = await trx
      .deleteFrom('essen.mahlzeit')
      .where('id', '=', mahlzeitId)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    // Close the gap in the order
    const rest = await trx
      .selectFrom('essen.mahlzeit')
      .select(['id', 'position'])
      .where('tag_id', '=', mahlzeit.tag_id)
      .orderBy('position')
      .orderBy('id')
      .execute();
    for (const [index, row] of rest.entries()) {
      if (row.position !== index + 1) {
        await trx
          .updateTable('essen.mahlzeit')
          .set({ position: index + 1 })
          .where('id', '=', row.id)
          .execute();
      }
    }
    return {
      result: undefined,
      details: { name: mahlzeit.name, datum: toDateString(mahlzeit.datum) },
    };
  });
}
