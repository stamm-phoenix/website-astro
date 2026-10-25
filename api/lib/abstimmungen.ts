/**
 * Abstimmungen in Azure SQL (schema `abstimmung`, `docs/abstimmungen.md`): Leitende legen eine
 * Frage mit Optionen an und stimmen im Leitendenbereich ab; Eingeladene und alle mit dem
 * gemeinsamen Link stimmen ohne Anmeldung ab. Jede Person hat einen persönlichen Link (`token`),
 * mit dem sie ihre Antwort ändert. Die Mails gehen einzeln, weil jede den persönlichen Link trägt.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Transaction, Updateable } from 'kysely';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  getLockDb,
  inTransaction,
  lockResource,
  requireVersion,
  toVersion,
} from './db';
import type { Db } from './db';
import type { Database } from './db-schema';
import { ValidationError } from './pflege-validation';
import {
  MAX_ABSTIMMUNG_TEILNAHMEN,
  abstimmungErgebnis,
  validateGewaehlt,
} from './abstimmung-model';
import type {
  AbstimmungAnsicht,
  AbstimmungDetail,
  AbstimmungEingabe,
  AbstimmungMailArt,
  AbstimmungRohdaten,
  AbstimmungTeilnahme,
  AbstimmungUebersicht,
} from './abstimmung-model';

/** Someone who is not the organizer tried to manage an Abstimmung. */
export class AbstimmungForbiddenError extends Error {
  constructor() {
    super('Nur die Person, die die Abstimmung angelegt hat, kann sie ändern.');
    this.name = 'AbstimmungForbiddenError';
  }
}

/** The Abstimmung is closed; nobody can vote any more. */
export class AbstimmungClosedError extends Error {
  constructor() {
    super('Diese Abstimmung ist beendet. Du kannst nicht mehr abstimmen.');
    this.name = 'AbstimmungClosedError';
  }
}

/** The logged-in person as the module recognizes them. */
export interface AbstimmungPerson {
  /** Login, lower case. */
  login: string;
  /** Display name for the results. */
  name: string;
  /**
   * Addresses an invitation to this person may have gone to: the login and the address of the
   * linked CampFlow person. An invitation to one of them is taken over when they vote here.
   */
  adressen: string[];
  /**
   * The address stored with an answer given here, so a later invitation to it finds the answer:
   * the linked CampFlow address, or the login when that address is shared, e.g. by a family.
   */
  adresse?: string;
}

/** What recognizes the logged-in person in the rows of an Abstimmung. */
export type AbstimmungIdentitaet = Pick<AbstimmungPerson, 'login' | 'adressen'>;

/** A secret for a link: 32 random bytes, base64url without padding (43 characters). */
export function newAbstimmungToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Whether a value can be a token at all; anything else is not looked up. */
export function isAbstimmungToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Whether a value can be the key of an answer try: a UUID from the page. */
export function isAbstimmungVersuch(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}

/** Link for everyone; whoever opens it enters a name. */
export function abstimmungLink(siteUrl: string, linkToken: string): string {
  return `${siteUrl}/abstimmung#link=${linkToken}`;
}

/** Personal link of one person, to answer and to change the answer. */
export function abstimmungPersonalLink(siteUrl: string, token: string): string {
  return `${siteUrl}/abstimmung#t=${token}`;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** A row of `abstimmung.abstimmung`. */
export interface AbstimmungKopf {
  id: number;
  version: Buffer;
  titel: string;
  beschreibung: string;
  mehrfach: boolean;
  link_token: string;
  erstellt_von: string;
  erstellt_von_name: string;
  erstellt_am: Date;
  geschlossen_am: Date | null;
}

async function loadRow(db: Db, id: number): Promise<AbstimmungKopf | undefined> {
  return db.selectFrom('abstimmung.abstimmung').selectAll().where('id', '=', id).executeTakeFirst();
}

async function loadOptionen(db: Db, id: number): Promise<{ id: number; text: string }[]> {
  return db
    .selectFrom('abstimmung.optionen')
    .select(['id', 'text'])
    .where('abstimmung_id', '=', id)
    .orderBy('position')
    .orderBy('id')
    .execute();
}

/** The votes of every person of the Abstimmung, by participation. */
async function loadStimmen(db: Db, id: number): Promise<Map<number, number[]>> {
  const rows = await db
    .selectFrom('abstimmung.stimme as s')
    .innerJoin('abstimmung.teilnahme as t', 't.id', 's.teilnahme_id')
    .select(['s.teilnahme_id', 's.option_id'])
    .where('t.abstimmung_id', '=', id)
    .execute();
  const result = new Map<number, number[]>();
  for (const row of rows) {
    const list = result.get(row.teilnahme_id) ?? [];
    list.push(row.option_id);
    result.set(row.teilnahme_id, list);
  }
  return result;
}

interface TeilnahmeRow {
  id: number;
  token: string;
  name: string;
  login: string | null;
  email: string | null;
  geantwortet_am: Date | null;
  mail_art: AbstimmungMailArt | null;
  mail_status: AbstimmungTeilnahme['mailStatus'];
  eingeladen_am: Date | null;
  erinnert_am: Date | null;
  familie: boolean;
}

async function loadTeilnahmen(db: Db, id: number): Promise<TeilnahmeRow[]> {
  return db
    .selectFrom('abstimmung.teilnahme')
    .select([
      'id',
      'token',
      'name',
      'login',
      'email',
      'geantwortet_am',
      'mail_art',
      'mail_status',
      'eingeladen_am',
      'erinnert_am',
      'familie',
    ])
    .where('abstimmung_id', '=', id)
    .orderBy('id')
    .execute();
}

interface Geladen {
  row: AbstimmungKopf;
  rohdaten: AbstimmungRohdaten;
  teilnahmen: TeilnahmeRow[];
  stimmen: Map<number, number[]>;
}

async function load(db: Db, id: number): Promise<Geladen | undefined> {
  const row = await loadRow(db, id);
  if (!row) return undefined;
  const [optionen, teilnahmen, stimmen] = await Promise.all([
    loadOptionen(db, id),
    loadTeilnahmen(db, id),
    loadStimmen(db, id),
  ]);
  const order = new Map(optionen.map((option, index) => [option.id, index]));
  const rohdaten: AbstimmungRohdaten = {
    id: row.id,
    titel: row.titel,
    beschreibung: row.beschreibung,
    mehrfach: row.mehrfach,
    geschlossen: row.geschlossen_am !== null,
    erstelltVonName: row.erstellt_von_name,
    optionen,
    // A family invitation only records that someone of the family answered
    antworten: teilnahmen
      .filter((teilnahme) => teilnahme.geantwortet_am !== null && !teilnahme.familie)
      .map((teilnahme) => ({
        teilnahmeId: teilnahme.id,
        name: teilnahme.name || 'Ohne Namen',
        gewaehlt: (stimmen.get(teilnahme.id) ?? []).sort(
          (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
        ),
      })),
  };
  return { row, rohdaten, teilnahmen, stimmen };
}

function ich(geladen: Geladen, teilnahme: TeilnahmeRow | undefined): AbstimmungAnsicht['ich'] {
  if (!teilnahme) return null;
  // The link of a family: everyone enters their own name and answer
  if (teilnahme.familie) return { name: '', gewaehlt: [], geantwortet: false };
  return {
    name: teilnahme.name,
    gewaehlt:
      geladen.rohdaten.antworten.find((a) => a.teilnahmeId === teilnahme.id)?.gewaehlt ?? [],
    geantwortet: teilnahme.geantwortet_am !== null,
  };
}

/**
 * The participation of the logged-in person: by login, else an invitation to one of their
 * addresses. A family invitation belongs to no single person.
 */
function eigeneTeilnahme<T extends Pick<TeilnahmeRow, 'login' | 'email' | 'familie'>>(
  teilnahmen: T[],
  person: AbstimmungIdentitaet
): T | undefined {
  return (
    teilnahmen.find((t) => t.login === person.login) ??
    teilnahmen.find(
      (t) => t.login === null && !t.familie && t.email && person.adressen.includes(t.email)
    )
  );
}

/** The Abstimmungen, newest first, with the own answer. */
export async function listAbstimmungen(
  person: AbstimmungIdentitaet
): Promise<AbstimmungUebersicht[]> {
  const db = getDb();
  const [rows, teilnahmen] = await Promise.all([
    db
      .selectFrom('abstimmung.abstimmung')
      .select(['id', 'titel', 'erstellt_von', 'erstellt_von_name', 'erstellt_am', 'geschlossen_am'])
      .orderBy('erstellt_am', 'desc')
      .orderBy('id', 'desc')
      .execute(),
    db
      .selectFrom('abstimmung.teilnahme')
      .select(['abstimmung_id', 'login', 'email', 'familie', 'geantwortet_am'])
      .execute(),
  ]);
  return rows.map((row) => {
    const eigene = teilnahmen.filter((t) => t.abstimmung_id === row.id);
    const mine = eigeneTeilnahme(eigene, person);
    return {
      id: row.id,
      titel: row.titel,
      geschlossen: row.geschlossen_am !== null,
      erstelltVonName: row.erstellt_von_name,
      erstelltAm: row.erstellt_am.toISOString(),
      eigene: row.erstellt_von === person.login,
      antworten: eigene.filter((t) => t.geantwortet_am !== null && !t.familie).length,
      ichGeantwortet: Boolean(mine?.geantwortet_am),
    };
  });
}

/** One Abstimmung for the Leitendenbereich; the organizer also gets the link and the invitations. */
export async function getAbstimmungDetail(
  id: number,
  person: AbstimmungIdentitaet,
  siteUrl: string
): Promise<AbstimmungDetail | undefined> {
  const geladen = await load(getDb(), id);
  if (!geladen) return undefined;
  const { row, teilnahmen } = geladen;
  const eigene = row.erstellt_von === person.login;
  return {
    ...abstimmungErgebnis(geladen.rohdaten),
    ich: ich(geladen, eigeneTeilnahme(teilnahmen, person)),
    etag: toVersion(row.version),
    erstelltAm: row.erstellt_am.toISOString(),
    eigene,
    link: eigene ? abstimmungLink(siteUrl, row.link_token) : null,
    teilnahmen: eigene
      ? teilnahmen.map((t) => ({
          id: t.id,
          name: t.name,
          email: t.email ?? '',
          geantwortet: t.geantwortet_am !== null,
          eingeladenAm: iso(t.eingeladen_am),
          erinnertAm: iso(t.erinnert_am),
          mailStatus: t.mail_status,
        }))
      : null,
  };
}

/** Title, organizer and state, e.g. to check rights and for the mails. */
export async function getAbstimmungKopf(id: number): Promise<AbstimmungKopf | undefined> {
  return loadRow(getDb(), id);
}

/** Inserts the options of the form in their order; `id`s were checked by the caller. */
async function writeOptionen(
  trx: Transaction<Database>,
  abstimmungId: number,
  input: AbstimmungEingabe
): Promise<void> {
  for (const [position, option] of input.optionen.entries()) {
    if (option.id) {
      await trx
        .updateTable('abstimmung.optionen')
        .set({ text: option.text, position })
        .where('id', '=', option.id)
        .where('abstimmung_id', '=', abstimmungId)
        .execute();
    } else {
      await trx
        .insertInto('abstimmung.optionen')
        .values({ abstimmung_id: abstimmungId, position, text: option.text })
        .execute();
    }
  }
}

/** Creates an Abstimmung with its options; returns its ID. */
export async function createAbstimmung(
  input: AbstimmungEingabe,
  person: Pick<AbstimmungPerson, 'login' | 'name'>
): Promise<number> {
  if (input.optionen.some((option) => option.id)) {
    throw new ValidationError({ optionen: 'Die Liste der Optionen ist ungültig.' });
  }
  return inTransaction(async (trx) => {
    const created = await trx
      .insertInto('abstimmung.abstimmung')
      .values({
        titel: input.titel,
        beschreibung: input.beschreibung,
        mehrfach: input.mehrfach,
        link_token: newAbstimmungToken(),
        erstellt_von: person.login,
        erstellt_von_name: person.name,
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    await writeOptionen(trx, created.id, input);
    return created.id;
  });
}

/** Takes the version of the loaded Abstimmung and checks the organizer. */
async function claimVersion(
  trx: Transaction<Database>,
  id: number,
  etag: string | undefined,
  login: string,
  changes: Updateable<Database['abstimmung.abstimmung']> = {}
): Promise<void> {
  // Same lock as a vote, so a vote checked against the old rules never lands after the change
  await lockResource(trx, `abstimmung:${id}`);
  const row = await loadRow(trx, id);
  if (!row) throw new RecordNotFoundError();
  if (row.erstellt_von !== login) throw new AbstimmungForbiddenError();
  const version = requireVersion(etag);
  const result = await trx
    .updateTable('abstimmung.abstimmung')
    .set({ titel: row.titel, ...changes })
    .where('id', '=', id)
    .where('version', '=', version)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) throw new VersionConflictError();
}

/**
 * Saves the form of the organizer. Options without `id` are new, missing ones are deleted with
 * their votes. Turning off `mehrfach` is refused while someone chose several of the options left.
 */
export async function updateAbstimmung(
  id: number,
  etag: string | undefined,
  input: AbstimmungEingabe,
  login: string
): Promise<void> {
  await inTransaction(async (trx) => {
    await claimVersion(trx, id, etag, login, {
      titel: input.titel,
      beschreibung: input.beschreibung,
      mehrfach: input.mehrfach,
    });
    const bisher = await loadOptionen(trx, id);
    const bekannt = new Set(bisher.map((option) => option.id));
    if (input.optionen.some((option) => option.id && !bekannt.has(option.id))) {
      throw new ValidationError({
        optionen: 'Eine Option wurde inzwischen gelöscht. Bitte lade die Abstimmung neu.',
      });
    }
    const bleiben = new Set(input.optionen.flatMap((option) => (option.id ? [option.id] : [])));
    const weg = bisher.filter((option) => !bleiben.has(option.id)).map((option) => option.id);
    if (weg.length) {
      // Votes cast after the form was opened are never deleted without the warning
      const gezaehlt = await trx
        .selectFrom('abstimmung.stimme')
        .select(['option_id', (eb) => eb.fn.countAll<number>().as('anzahl')])
        .where('option_id', 'in', weg)
        .groupBy('option_id')
        .execute();
      const neu = gezaehlt.find(
        (row) => Number(row.anzahl) > (input.bekannteStimmen[row.option_id] ?? 0)
      );
      if (neu) {
        const text = bisher.find((option) => option.id === neu.option_id)?.text ?? '';
        throw new ValidationError({
          optionen: `Inzwischen hat jemand für „${text}“ gestimmt. Lade die Abstimmung neu und entscheide dann, ob du die Option trotzdem entfernst.`,
        });
      }
      await trx.deleteFrom('abstimmung.stimme').where('option_id', 'in', weg).execute();
      await trx.deleteFrom('abstimmung.optionen').where('id', 'in', weg).execute();
    }
    if (!input.mehrfach) {
      const mehrere = await trx
        .selectFrom('abstimmung.stimme as s')
        .innerJoin('abstimmung.teilnahme as t', 't.id', 's.teilnahme_id')
        .select('s.teilnahme_id')
        .where('t.abstimmung_id', '=', id)
        .groupBy('s.teilnahme_id')
        .having((eb) => eb.fn.countAll(), '>', 1)
        .executeTakeFirst();
      if (mehrere) {
        throw new ValidationError({
          mehrfach:
            'Es haben schon Leute mehrere Optionen gewählt. Lass „Mehrere Optionen wählbar“ an oder leg eine neue Abstimmung an.',
        });
      }
    }
    await writeOptionen(trx, id, input);
  });
}

/** Ends the Abstimmung or opens it again. */
export async function setAbstimmungGeschlossen(
  id: number,
  etag: string | undefined,
  geschlossen: boolean,
  login: string
): Promise<void> {
  await inTransaction(async (trx) => {
    await claimVersion(trx, id, etag, login, {
      geschlossen_am: geschlossen ? new Date().toISOString() : null,
    });
    // Waits for a mail being sent; the next one sees the Abstimmung ended and stays queued
    if (geschlossen) await lockResource(trx, mailLock(id));
  });
}

/** Deletes the Abstimmung with its options, invitations and votes. */
export async function deleteAbstimmung(
  id: number,
  etag: string | undefined,
  login: string
): Promise<void> {
  await inTransaction(async (trx) => {
    await claimVersion(trx, id, etag, login);
    const teilnahmen = trx
      .selectFrom('abstimmung.teilnahme')
      .select('id')
      .where('abstimmung_id', '=', id);
    await trx.deleteFrom('abstimmung.stimme').where('teilnahme_id', 'in', teilnahmen).execute();
    await trx.deleteFrom('abstimmung.teilnahme').where('abstimmung_id', '=', id).execute();
    await trx.deleteFrom('abstimmung.optionen').where('abstimmung_id', '=', id).execute();
    await trx.deleteFrom('abstimmung.abstimmung').where('id', '=', id).execute();
  });
}

/** Replaces the votes of one person and marks the answer. */
async function writeAntwort(
  trx: Transaction<Database>,
  teilnahmeId: number,
  name: string,
  gewaehlt: number[]
): Promise<void> {
  await trx.deleteFrom('abstimmung.stimme').where('teilnahme_id', '=', teilnahmeId).execute();
  if (gewaehlt.length) {
    await trx
      .insertInto('abstimmung.stimme')
      .values(gewaehlt.map((option_id) => ({ teilnahme_id: teilnahmeId, option_id })))
      .execute();
  }
  await trx
    .updateTable('abstimmung.teilnahme')
    .set({ name, geantwortet_am: new Date().toISOString() })
    .where('id', '=', teilnahmeId)
    .execute();
}

/** Refuses new people once the Abstimmung has `MAX_ABSTIMMUNG_TEILNAHMEN`. */
async function assertPlatz(trx: Transaction<Database>, id: number, neu: number): Promise<void> {
  const { count } = await trx
    .selectFrom('abstimmung.teilnahme')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('abstimmung_id', '=', id)
    .executeTakeFirstOrThrow();
  if (Number(count) + neu > MAX_ABSTIMMUNG_TEILNAHMEN) {
    throw new ValidationError({
      form: `Bei dieser Abstimmung machen schon ${MAX_ABSTIMMUNG_TEILNAHMEN} Personen mit, mehr gehen nicht. Deine Antwort wurde nicht gespeichert. Sag der Person Bescheid, die dich eingeladen hat.`,
    });
  }
}

/** Opens an Abstimmung for a vote: it exists and is not closed. */
async function openForVote(trx: Transaction<Database>, id: number): Promise<AbstimmungKopf> {
  await lockResource(trx, `abstimmung:${id}`);
  const row = await loadRow(trx, id);
  if (!row) throw new RecordNotFoundError();
  if (row.geschlossen_am) throw new AbstimmungClosedError();
  return row;
}

/**
 * Saves the answer of a leader in the Leitendenbereich. An invitation to one of their addresses
 * becomes theirs, so the reminder knows they answered.
 */
export async function voteAsStaff(
  id: number,
  person: AbstimmungPerson,
  gewaehltInput: unknown
): Promise<void> {
  await inTransaction(async (trx) => {
    const row = await openForVote(trx, id);
    const optionen = await loadOptionen(trx, id);
    const gewaehlt = validateGewaehlt(
      gewaehltInput,
      optionen.map((option) => option.id),
      row.mehrfach
    );
    const teilnahmen = await loadTeilnahmen(trx, id);
    let teilnahme = eigeneTeilnahme(teilnahmen, person);
    // An invitation to the person's own address next to the row of their login, e.g. when the
    // CampFlow address could not be loaded at an earlier vote: the invitation stays, because its
    // link went out by mail, and takes over the login. The login row goes only if it never had a
    // mail itself; two invitations both stay, so no link that went out stops working
    const einladung = teilnahmen.find(
      (t) =>
        t.id !== teilnahme?.id &&
        t.login === null &&
        !t.familie &&
        t.email &&
        person.adressen.includes(t.email)
    );
    if (teilnahme?.login === person.login && teilnahme.mail_status === null && einladung) {
      await trx.deleteFrom('abstimmung.stimme').where('teilnahme_id', '=', teilnahme.id).execute();
      await trx.deleteFrom('abstimmung.teilnahme').where('id', '=', teilnahme.id).execute();
      teilnahme = { ...einladung, login: null };
    }
    let teilnahmeId: number;
    if (teilnahme) {
      teilnahmeId = teilnahme.id;
      if (teilnahme.login === null) {
        await trx
          .updateTable('abstimmung.teilnahme')
          .set({ login: person.login })
          .where('id', '=', teilnahme.id)
          .execute();
      }
    } else {
      await assertPlatz(trx, id, 1);
      // So a later invitation to this address finds the answer instead of adding the person
      const vergeben = new Set(teilnahmen.map((t) => t.email));
      const email = person.adresse && !vergeben.has(person.adresse) ? person.adresse : null;
      teilnahmeId = (
        await trx
          .insertInto('abstimmung.teilnahme')
          .values({ abstimmung_id: id, token: newAbstimmungToken(), login: person.login, email })
          .output('inserted.id')
          .executeTakeFirstOrThrow()
      ).id;
    }
    await writeAntwort(trx, teilnahmeId, person.name, gewaehlt);
  });
}

/** What a link opens: the Abstimmung and, for a personal link, the person. */
interface LinkZiel {
  abstimmungId: number;
  teilnahmeId: number | null;
}

async function findLink(
  db: Db,
  link: { link?: unknown; token?: unknown }
): Promise<LinkZiel | undefined> {
  if (isAbstimmungToken(link.token)) {
    const row = await db
      .selectFrom('abstimmung.teilnahme')
      .select(['id', 'abstimmung_id'])
      .where('token', '=', link.token)
      .executeTakeFirst();
    return row ? { abstimmungId: row.abstimmung_id, teilnahmeId: row.id } : undefined;
  }
  if (isAbstimmungToken(link.link)) {
    const row = await db
      .selectFrom('abstimmung.abstimmung')
      .select('id')
      .where('link_token', '=', link.link)
      .executeTakeFirst();
    return row ? { abstimmungId: row.id, teilnahmeId: null } : undefined;
  }
  return undefined;
}

/** The Abstimmung behind a shared (`link`) or personal (`token`) link, or `undefined`. */
export async function getAbstimmungAnsicht(link: {
  link?: unknown;
  token?: unknown;
}): Promise<AbstimmungAnsicht | undefined> {
  const db = getDb();
  const ziel = await findLink(db, link);
  if (!ziel) return undefined;
  const geladen = await load(db, ziel.abstimmungId);
  if (!geladen) return undefined;
  return {
    ...abstimmungErgebnis(geladen.rohdaten),
    ich: ich(
      geladen,
      geladen.teilnahmen.find((t) => t.id === ziel.teilnahmeId)
    ),
  };
}

/**
 * Saves an answer from the public page. A personal link changes that person's answer; the
 * shared link adds a new person and returns their personal link token.
 */
export async function votePublic(
  link: { link?: unknown; token?: unknown },
  name: string,
  gewaehltInput: unknown,
  /** Key the page sends with every try of the same new answer (`isAbstimmungVersuch`). */
  versuch?: string
): Promise<{ token: string } | undefined> {
  const ziel = await findLink(getDb(), link);
  if (!ziel) return undefined;
  return inTransaction(async (trx) => {
    const row = await openForVote(trx, ziel.abstimmungId);
    const optionen = await loadOptionen(trx, row.id);
    const gewaehlt = validateGewaehlt(
      gewaehltInput,
      optionen.map((option) => option.id),
      row.mehrfach
    );
    let familie: number | undefined;
    if (ziel.teilnahmeId !== null) {
      const teilnahme = await trx
        .selectFrom('abstimmung.teilnahme')
        .select(['token', 'familie'])
        .where('id', '=', ziel.teilnahmeId)
        .executeTakeFirst();
      if (!teilnahme) throw new RecordNotFoundError();
      // A personal link changes the answer of its person, also a corrected name
      if (!teilnahme.familie) {
        await writeAntwort(trx, ziel.teilnahmeId, name, gewaehlt);
        return { token: teilnahme.token };
      }
      // The link of a family adds everyone who answers with it as a person of their own
      familie = ziel.teilnahmeId;
    }
    // A repeated request whose first answer arrived, but not its response
    if (versuch) {
      const frueher = await trx
        .selectFrom('abstimmung.teilnahme')
        .select(['id', 'token'])
        .where('abstimmung_id', '=', row.id)
        .where('versuch', '=', versuch)
        .executeTakeFirst();
      if (frueher) {
        await writeAntwort(trx, frueher.id, name, gewaehlt);
        return { token: frueher.token };
      }
    }
    await assertPlatz(trx, row.id, 1);
    const token = newAbstimmungToken();
    const created = await trx
      .insertInto('abstimmung.teilnahme')
      .values({ abstimmung_id: row.id, token, name, versuch: versuch ?? null })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    await writeAntwort(trx, created.id, name, gewaehlt);
    if (familie !== undefined) {
      // Someone of the family answered: the reminder no longer goes to the address
      await trx
        .updateTable('abstimmung.teilnahme')
        .set({ geantwortet_am: new Date().toISOString() })
        .where('id', '=', familie)
        .where('geantwortet_am', 'is', null)
        .execute();
    }
    return { token };
  });
}

/** Logins of the leaders who answered in the Leitendenbereich. */
export async function getAbstimmungLogins(id: number): Promise<string[]> {
  const rows = await getDb()
    .selectFrom('abstimmung.teilnahme')
    .select('login')
    .where('abstimmung_id', '=', id)
    .where('login', 'is not', null)
    .execute();
  return rows.flatMap((row) => (row.login ? [row.login] : []));
}

/** Counts of the mails of one Abstimmung. */
export interface AbstimmungMailStand {
  /** Still to send. */
  offen: number;
  gesendet: number;
  /** Reserved, but unclear whether the mail went out; never sent again automatically. */
  unklar: number;
}

export async function getAbstimmungMailStand(id: number): Promise<AbstimmungMailStand> {
  const rows = await getDb()
    .selectFrom('abstimmung.teilnahme')
    .select(['mail_status'])
    .where('abstimmung_id', '=', id)
    .where('mail_status', 'is not', null)
    .execute();
  return {
    offen: rows.filter((row) => row.mail_status === 'offen').length,
    gesendet: rows.filter((row) => row.mail_status === 'gesendet').length,
    unklar: rows.filter((row) => row.mail_status === 'versucht').length,
  };
}

/** An address to invite, with the name from CampFlow if known. */
export interface AbstimmungEinladung {
  email: string;
  name: string;
  /** Several CampFlow persons share the address, e.g. a family. */
  familie: boolean;
}

/**
 * Queues an invitation for every address that has none yet; addresses invited before are left
 * as they are. Returns how many are new and how many were invited already.
 */
export async function queueAbstimmungEinladungen(
  id: number,
  login: string,
  einladungen: AbstimmungEinladung[],
  /**
   * CampFlow addresses of leaders who answered here with their login; an invitation to one of
   * them alone would count them twice. A family address still gets its invitation.
   */
  eigeneAdressen: readonly string[] = []
): Promise<{ neu: number; schon: number }> {
  return inTransaction(async (trx) => {
    const row = await openForVote(trx, id);
    if (row.erstellt_von !== login) throw new AbstimmungForbiddenError();
    // Leaders who answered here count with their login and their stored address
    const vorhanden = new Set(
      (
        await trx
          .selectFrom('abstimmung.teilnahme')
          .select(['email', 'login'])
          .where('abstimmung_id', '=', id)
          .execute()
      ).flatMap((t) => [t.email, t.login])
    );
    const beantwortet = new Set(eigeneAdressen);
    const neu = einladungen.filter(
      (einladung) =>
        !vorhanden.has(einladung.email) && (einladung.familie || !beantwortet.has(einladung.email))
    );
    if (neu.length) {
      await assertPlatz(trx, id, neu.length);
      // SQL Server takes at most 2100 parameters per statement
      for (let index = 0; index < neu.length; index += 200) {
        await trx
          .insertInto('abstimmung.teilnahme')
          .values(
            neu.slice(index, index + 200).map((einladung) => ({
              abstimmung_id: id,
              token: newAbstimmungToken(),
              name: einladung.name,
              email: einladung.email,
              familie: einladung.familie,
              mail_art: 'einladung' as const,
              mail_status: 'offen' as const,
            }))
          )
          .execute();
      }
    }
    return { neu: neu.length, schon: einladungen.length - neu.length };
  });
}

/** Invited people who have not answered and whose last mail is done (sent or unclear). */
function erinnerungKandidaten(db: Db, id: number) {
  return db
    .selectFrom('abstimmung.teilnahme')
    .where('abstimmung_id', '=', id)
    .where('geantwortet_am', 'is', null)
    .where('email', 'is not', null)
    .where('mail_status', 'in', ['gesendet', 'versucht']);
}

/** How many people a reminder would go to. */
export async function countAbstimmungErinnerungen(id: number): Promise<number> {
  const { count } = await erinnerungKandidaten(getDb(), id)
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return Number(count);
}

/** Queues a reminder for everyone invited who has not answered yet; returns how many. */
export async function queueAbstimmungErinnerungen(id: number, login: string): Promise<number> {
  return inTransaction(async (trx) => {
    const row = await openForVote(trx, id);
    if (row.erstellt_von !== login) throw new AbstimmungForbiddenError();
    // Waits for a mail being sent, so `versucht` below only means an unclear result
    await lockResource(trx, mailLock(id));
    const ids = (await erinnerungKandidaten(trx, id).select('id').execute()).map((t) => t.id);
    if (!ids.length) return 0;
    await trx
      .updateTable('abstimmung.teilnahme')
      .set({ mail_art: 'erinnerung', mail_status: 'offen' })
      .where('id', 'in', ids)
      .execute();
    return ids.length;
  });
}

/** A reserved mail. */
export interface AbstimmungMail {
  teilnahmeId: number;
  email: string;
  name: string;
  token: string;
  art: AbstimmungMailArt;
  familie: boolean;
}

/** Held while one mail is reserved and sent, so a reminder cannot queue it again meanwhile. */
function mailLock(id: number): string {
  return `abstimmung:${id}:mail`;
}

/**
 * Reserves the next queued mail, sends it with `send` and marks it as sent, all while holding
 * the mail lock. A failing `send` leaves the mail reserved (`versucht`), never sent again
 * automatically. Returns whether a mail was sent, none was queued or the Abstimmung is ended.
 */
export async function sendNextAbstimmungMail(
  id: number,
  send: (mail: AbstimmungMail) => Promise<void>
): Promise<'gesendet' | 'keine' | 'beendet'> {
  // Not `inTransaction`: the mail must not be sent again after a deadlock retry. The
  // transaction only holds the lock; reserving and marking commit on their own.
  // The lock pool, so waiting senders never hold the connections reserving and marking need
  return getLockDb()
    .transaction()
    .execute(async (trx) => {
      await lockResource(trx, mailLock(id));
      // Ending takes the same lock, so no mail starts after the Abstimmung was ended
      const row = await loadRow(getDb(), id);
      if (!row || row.geschlossen_am) return 'beendet';
      const mail = await reserveAbstimmungMail(id);
      if (!mail) return 'keine';
      await send(mail);
      await markAbstimmungMailSent(mail);
      return 'gesendet';
    });
}

/** Reserves the next mail to send; concurrent steps never get the same one. */
export async function reserveAbstimmungMail(id: number): Promise<AbstimmungMail | undefined> {
  // READCOMMITTEDLOCK: READPAST needs locking reads, Azure SQL reads row versions by default
  const result = await sql<{
    id: number;
    email: string;
    name: string;
    token: string;
    mail_art: AbstimmungMailArt;
    familie: boolean;
  }>`
    WITH next AS (
      SELECT TOP (1) id, email, name, token, mail_art, mail_status, familie
      FROM abstimmung.teilnahme WITH (UPDLOCK, READPAST, READCOMMITTEDLOCK)
      WHERE abstimmung_id = ${id} AND mail_status = 'offen'
      ORDER BY id
    )
    UPDATE next SET mail_status = 'versucht'
    OUTPUT inserted.id, inserted.email, inserted.name, inserted.token, inserted.mail_art, inserted.familie;
  `.execute(getDb());
  const row = result.rows[0];
  return row
    ? {
        teilnahmeId: row.id,
        email: row.email,
        name: row.name,
        token: row.token,
        art: row.mail_art,
        familie: Boolean(row.familie),
      }
    : undefined;
}

/** Marks a reserved mail as sent. */
export async function markAbstimmungMailSent(mail: AbstimmungMail): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .updateTable('abstimmung.teilnahme')
    .set({
      mail_status: 'gesendet',
      ...(mail.art === 'einladung' ? { eingeladen_am: now } : { erinnert_am: now }),
    })
    .where('id', '=', mail.teilnahmeId)
    .where('mail_status', '=', 'versucht')
    .execute();
}
