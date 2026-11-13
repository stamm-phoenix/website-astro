import type { Transaction } from 'kysely';
import { RecordNotFoundError, getDb, inTransaction, lockResource } from './db';
import type { Db } from './db';
import type { Database } from './db-schema';
import { ValidationError } from './validation/errors';
import {
  MAX_ABSTIMMUNG_TEILNAHMEN,
  abstimmungEinsicht,
  abstimmungErgebnis,
} from './abstimmung-model';
import { validateAntwort } from './abstimmung-schema';
import type { AbstimmungAnsicht } from './abstimmung-model';
import { AbstimmungClosedError, newAbstimmungToken, isAbstimmungToken } from './abstimmungen-basis';
import type { AbstimmungPerson } from './abstimmungen-basis';
import {
  loadRow,
  loadOptionen,
  loadTeilnahmen,
  load,
  ich,
  hauptTeilnahme,
  eigeneTeilnahme,
} from './abstimmungen-lesen';
import type { AbstimmungKopf, Antwort, TeilnahmeRow } from './abstimmungen-lesen';

/** Replaces the votes of one person and marks the answer. */
async function writeAntwort(
  trx: Transaction<Database>,
  teilnahmeId: number,
  name: string,
  antwort: Antwort
): Promise<void> {
  await trx.deleteFrom('abstimmung.stimme').where('teilnahme_id', '=', teilnahmeId).execute();
  const values = [
    ...antwort.gewaehlt.map((option_id) => ({ teilnahme_id: teilnahmeId, option_id })),
    ...antwort.vielleicht.map((option_id) => ({
      teilnahme_id: teilnahmeId,
      option_id,
      vielleicht: true,
    })),
  ];
  if (values.length) await trx.insertInto('abstimmung.stimme').values(values).execute();
  await trx
    .updateTable('abstimmung.teilnahme')
    .set({ name, geantwortet_am: new Date().toISOString() })
    .where('id', '=', teilnahmeId)
    .execute();
  await dropErinnerungen(trx, [teilnahmeId]);
}

/**
 * Takes back a queued reminder of someone who answered meanwhile, so it neither goes out nor
 * keeps the mails open. A reminder already being sent is not stopped.
 */
async function dropErinnerungen(trx: Transaction<Database>, ids: number[]): Promise<void> {
  if (!ids.length) return;
  await trx
    .updateTable('abstimmung.teilnahme')
    .set({ mail_status: 'gesendet' })
    .where('id', 'in', ids)
    .where('mail_art', '=', 'erinnerung')
    .where('mail_status', '=', 'offen')
    .execute();
}

/**
 * Refuses new people once the Abstimmung has `MAX_ABSTIMMUNG_TEILNAHMEN`, with the message for
 * whoever adds them: a guest, a leader voting, or the organizer inviting.
 */
export async function assertPlatz(
  trx: Transaction<Database>,
  id: number,
  neu: number,
  wer: 'gast' | 'leitung' | 'einladung'
): Promise<void> {
  const { count } = await trx
    .selectFrom('abstimmung.teilnahme')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('abstimmung_id', '=', id)
    .executeTakeFirstOrThrow();
  const vorhanden = Number(count);
  if (vorhanden + neu <= MAX_ABSTIMMUNG_TEILNAHMEN) return;
  const voll = `Bei dieser Abstimmung machen schon ${MAX_ABSTIMMUNG_TEILNAHMEN} Personen mit, mehr gehen nicht. Deine Antwort wurde nicht gespeichert.`;
  throw new ValidationError({
    form:
      wer === 'einladung'
        ? `Bei einer Abstimmung können höchstens ${MAX_ABSTIMMUNG_TEILNAHMEN} Personen mitmachen. Es sind schon ${vorhanden}, dazu kämen ${neu} neue. Wähle weniger Personen aus.`
        : wer === 'leitung'
          ? `${voll} Sag der Person Bescheid, die die Abstimmung angelegt hat.`
          : `${voll} Sag der Person Bescheid, die dich eingeladen hat.`,
  });
}

/** Opens an Abstimmung for a vote: it exists and is not closed. */
export async function openForVote(trx: Transaction<Database>, id: number): Promise<AbstimmungKopf> {
  await lockResource(trx, `abstimmung:${id}`);
  const row = await loadRow(trx, id);
  if (!row) throw new RecordNotFoundError();
  if (row.geschlossen_am) throw new AbstimmungClosedError();
  return row;
}

/** An answer as sent by a page: option IDs with „Ja“ and with „Vielleicht“, unchecked. */
export interface AbstimmungAntwortEingabe {
  gewaehlt: unknown;
  vielleicht?: unknown;
}

/** Checks an answer against the current options and rules of the Abstimmung. */
async function checkAntwort(
  trx: Transaction<Database>,
  row: AbstimmungKopf,
  eingabe: AbstimmungAntwortEingabe
): Promise<Antwort> {
  const optionen = await loadOptionen(trx, row.id);
  return validateAntwort(eingabe.gewaehlt, eingabe.vielleicht, {
    optionIds: optionen.map((option) => option.id),
    maxAuswahl: row.max_auswahl,
    vielleichtErlaubt: row.vielleicht,
  });
}

/**
 * Saves the answer of a leader in the Leitendenbereich. An invitation to one of their addresses
 * becomes theirs, so the reminder knows they answered.
 */
export async function voteAsStaff(
  id: number,
  person: AbstimmungPerson,
  eingabe: AbstimmungAntwortEingabe
): Promise<void> {
  await inTransaction(async (trx) => {
    const row = await openForVote(trx, id);
    const antwort = await checkAntwort(trx, row, eingabe);
    const teilnahmen = await loadTeilnahmen(trx, id);
    let teilnahme = eigeneTeilnahme(teilnahmen, person);
    // An invitation to the person's own address next to the row of their login, e.g. when the
    // CampFlow address could not be loaded at an earlier vote: the invitation stays, because its
    // link went out by mail, and takes over the login. The login row goes only if it never had a
    // mail itself; two invitations both stay, so no link that went out stops working
    const eigeneEinladung = (t: TeilnahmeRow): boolean =>
      t.login === null &&
      !t.familie &&
      t.alias_von === null &&
      Boolean(t.email && person.adressen.includes(t.email));
    const einladung = teilnahmen.find((t) => t.id !== teilnahme?.id && eigeneEinladung(t));
    if (teilnahme?.login === person.login && teilnahme.mail_status === null && einladung) {
      await trx
        .updateTable('abstimmung.teilnahme')
        .set({ alias_von: einladung.id })
        .where('alias_von', '=', teilnahme.id)
        .execute();
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
      await assertPlatz(trx, id, 1, 'leitung');
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
    await writeAntwort(trx, teilnahmeId, person.name, antwort);
    // Further invitations to the person's addresses: their links answer through this one, so
    // the person counts once and gets no reminder there
    const weitere = teilnahmen
      .filter((t) => t.id !== teilnahmeId && eigeneEinladung(t))
      .map((t) => t.id);
    if (weitere.length) {
      await trx.deleteFrom('abstimmung.stimme').where('teilnahme_id', 'in', weitere).execute();
      await trx
        .updateTable('abstimmung.teilnahme')
        .set({ alias_von: teilnahmeId, geantwortet_am: null })
        .where('id', 'in', weitere)
        .execute();
      await dropErinnerungen(trx, weitere);
    }
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
  const eigeneZeile = geladen.teilnahmen.find((t) => t.id === ziel.teilnahmeId);
  return {
    // Whoever comes over a link never manages the Abstimmung
    ...abstimmungErgebnis(
      geladen.rohdaten,
      abstimmungEinsicht(geladen.rohdaten.sichtbarkeit, false)
    ),
    ich: ich(geladen, eigeneZeile && hauptTeilnahme(geladen.teilnahmen, eigeneZeile)),
  };
}

/**
 * Saves an answer from the public page. A personal link changes that person's answer; the
 * shared link adds a new person and returns their personal link token.
 */
export async function votePublic(
  link: { link?: unknown; token?: unknown },
  name: string,
  eingabe: AbstimmungAntwortEingabe,
  /** Key the page sends with every try of the same new answer (`isAbstimmungVersuch`). */
  versuch?: string
): Promise<{ token: string } | undefined> {
  const ziel = await findLink(getDb(), link);
  if (!ziel) return undefined;
  return inTransaction(async (trx) => {
    const row = await openForVote(trx, ziel.abstimmungId);
    const gewaehlt = await checkAntwort(trx, row, eingabe);
    let familie: number | undefined;
    if (ziel.teilnahmeId !== null) {
      const teilnahme = await trx
        .selectFrom('abstimmung.teilnahme')
        .select(['token', 'familie', 'alias_von'])
        .where('id', '=', ziel.teilnahmeId)
        .executeTakeFirst();
      if (!teilnahme) throw new RecordNotFoundError();
      // A personal link changes the answer of its person, also a corrected name; the link stays
      if (!teilnahme.familie) {
        await writeAntwort(trx, teilnahme.alias_von ?? ziel.teilnahmeId, name, gewaehlt);
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
    await assertPlatz(trx, row.id, 1, 'gast');
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
      await dropErinnerungen(trx, [familie]);
    }
    return { token };
  });
}
