import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type { CampflowPerson } from './campflow';
import { CampflowError, campflowGet, campflowGetAll, getCampflowMembers } from './campflow';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  getSqlErrorNumber,
  requireVersion,
  toVersion,
} from './db';
import type { PersonTable } from './db-schema';
import type {
  CampflowMitglied,
  Ich,
  Person,
  PersonInput,
  PersonenUebersicht,
} from './personen-model';
import { sameName } from './personen-model';
import { ValidationError } from './pflege-validation';
import { getTaskDirectoryUsers } from './task-directory';

/**
 * The module „Personen“ (`docs/personen.md`, `organisation.person`, migrations
 * `0018_weitere_personen.sql` and `0037_personen.sql`): links the accounts of the leaders to
 * their person in the CampFlow member list, and keeps Altleitende and others who often take part
 * but are not in the Entra group of the leaders. The Protokoll-Editor offers the active ones
 * next to the leaders.
 */

const MEMBER_PERSONS = '/lists/member/persons';

function toPerson(row: Selectable<PersonTable>): Person {
  return {
    id: row.id,
    name: row.name,
    login: row.login,
    gruppe: row.gruppe,
    campflowPersonId: row.campflow_person_id,
    aktiv: row.aktiv,
    etag: toVersion(row.version),
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
  };
}

/** All people of the list, active ones first, then by name. */
export async function getPersonen(): Promise<Person[]> {
  const rows = await getDb().selectFrom('organisation.person').selectAll().execute();
  return rows
    .map(toPerson)
    .sort((a, b) => Number(b.aktiv) - Number(a.aktiv) || a.name.localeCompare(b.name, 'de'));
}

function toRow(
  input: PersonInput
): Omit<Selectable<PersonTable>, 'id' | 'version' | 'created_at' | 'updated_at' | 'updated_by'> {
  return {
    name: input.name,
    login: input.login,
    gruppe: input.gruppe,
    campflow_person_id: input.campflowPersonId,
    aktiv: input.aktiv,
  };
}

/** A login or CampFlow person that another row has already becomes a field error. */
async function unique<T>(input: PersonInput, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error: unknown) {
    if (![2601, 2627].includes(getSqlErrorNumber(error) ?? 0) || !(error instanceof Error))
      throw error;
    const others = await getPersonen();
    if (error.message.includes('uq_person_campflow_person_id')) {
      const other = others.find((p) => p.campflowPersonId === input.campflowPersonId);
      throw new ValidationError({
        campflowPersonId: `Diese CampFlow-Person ist schon mit ${other?.name ?? 'jemand anderem'} verknüpft.`,
      });
    }
    if (error.message.includes('uq_person_login')) {
      const other = others.find((p) => p.login === input.login);
      throw new ValidationError({
        login: `Dieses Microsoft-Konto steht schon bei ${other?.name ?? 'jemand anderem'}.`,
      });
    }
    throw error;
  }
}

export async function createPerson(input: PersonInput, actor: string): Promise<number> {
  const { id } = await unique(input, () =>
    getDb()
      .insertInto('organisation.person')
      .values({ ...toRow(input), updated_by: actor })
      .output('inserted.id')
      .executeTakeFirstOrThrow()
  );
  forgetIch();
  return id;
}

async function notChanged(id: number): Promise<never> {
  const exists = await getDb()
    .selectFrom('organisation.person')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

/** Saves a person if it still has the version `etag`. */
export async function updatePerson(
  id: number,
  input: PersonInput,
  etag: string,
  actor: string
): Promise<void> {
  const result = await unique(input, () =>
    getDb()
      .updateTable('organisation.person')
      .set({ ...toRow(input), updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst()
  );
  if (Number(result.numUpdatedRows) === 0) await notChanged(id);
  // A changed or removed link must not show the former person any longer
  forgetIch();
}

/** Deletes a person if it still has the version `etag`; old minutes keep the name. */
export async function deletePerson(id: number, etag: string): Promise<void> {
  const result = await getDb()
    .deleteFrom('organisation.person')
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) await notChanged(id);
  forgetIch();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function names(person: CampflowPerson): { firstName: string; lastName: string } {
  const name = (person.name ?? {}) as Record<string, unknown>;
  return { firstName: text(name.first_name), lastName: text(name.last_name) };
}

function berlinToday(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now);
}

/** Reduces a person of the member list to its name and groups; no contact details. */
export function toCampflowMitglied(person: CampflowPerson, today: string): CampflowMitglied {
  const leaveDate = text(person.leave_date);
  return {
    id: person.id,
    ...names(person),
    groups: Array.isArray(person.group_names)
      ? person.group_names.filter((g): g is string => typeof g === 'string').map((g) => g.trim())
      : [],
    ausgetreten: leaveDate !== '' && leaveDate <= today,
  };
}

/** The persons of the CampFlow member list, by name; throws `CampflowError` if it fails. */
export async function getCampflowMitglieder(now: Date = new Date()): Promise<CampflowMitglied[]> {
  const today = berlinToday(now);
  return (await getCampflowMembers())
    .filter((person) => typeof person.id === 'string')
    .map((person) => toCampflowMitglied(person, today))
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de')
    );
}

/**
 * How long the overview waits for Entra and CampFlow at most, all pages together; then the source
 * is `null` and the list still loads within the time limit of Static Web Apps (45 seconds).
 */
export const UEBERSICHT_TIMEOUT_MS = 25_000;

/** `promise`, or `null` if it takes longer than `timeoutMs`; a later answer is dropped. */
async function innerhalb<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The list with the Entra group and the CampFlow member list; a failing source is `null`. */
export async function getPersonenUebersicht(
  timeoutMs: number = UEBERSICHT_TIMEOUT_MS
): Promise<PersonenUebersicht> {
  const [personen, leitende, campflow] = await Promise.all([
    getPersonen(),
    innerhalb(
      getTaskDirectoryUsers().then(
        (users) => users.map(({ login, name }) => ({ login, name })),
        () => null
      ),
      timeoutMs
    ),
    innerhalb(
      getCampflowMitglieder().catch((error: unknown) => {
        if (error instanceof CampflowError) return null;
        throw error;
      }),
      timeoutMs
    ),
  ]);
  return { personen, leitende, campflow };
}

/** The ID of the CampFlow person linked to a login, or `undefined`. */
export async function getCampflowPersonId(login: string): Promise<string | undefined> {
  const row = await getDb()
    .selectFrom('organisation.person')
    .select('campflow_person_id')
    .where('login', '=', login.trim().toLowerCase())
    .executeTakeFirst();
  return row?.campflow_person_id || undefined;
}

/** How long name and address of a CampFlow person stay in memory at most (`/datenschutz`). */
export const ICH_CACHE_MS = 10 * 60_000;
/** The linked person with its primary address, which stays on the server. */
type Verknuepfte = NonNullable<Ich['campflow']> & {
  email: string;
  /**
   * Another person of the member list has the same primary address, e.g. a child of the family.
   * Then the address alone does not tell who a registration is.
   */
  adresseGeteilt: boolean;
};
interface IchEintrag {
  at: number;
  campflow: Verknuepfte;
}
const ichCache = new Map<string, IchEintrag>();

/** Keeps a CampFlow person in memory and removes it after `ICH_CACHE_MS`, even if unused. */
export function rememberIch(id: string, campflow: IchEintrag['campflow'], now: number): void {
  const entry = { at: now, campflow };
  ichCache.set(id, entry);
  const timer = setTimeout(() => {
    // A newer load of the same person keeps its own time
    if (ichCache.get(id) === entry) ichCache.delete(id);
  }, ICH_CACHE_MS);
  timer.unref?.();
}

/** The CampFlow person in memory, if any. */
export function cachedIch(id: string): IchEintrag | undefined {
  return ichCache.get(id);
}

/** Forgets every CampFlow person in memory, e.g. after a link changed. */
function forgetIch(): void {
  ichCache.clear();
}

/**
 * The CampFlow person linked to a login, with name and primary address, from memory or CampFlow;
 * `null` without a link. If CampFlow fails, the ID alone is returned.
 */
async function getVerknuepfte(login: string, now: number): Promise<Verknuepfte | null> {
  const id = await getCampflowPersonId(login);
  return id ? ladeVerknuepfte(id, now) : null;
}

/** The linked CampFlow person by its ID, from memory or CampFlow. */
async function ladeVerknuepfte(id: string, now: number): Promise<Verknuepfte> {
  const cached = ichCache.get(id);
  if (cached && now - cached.at < ICH_CACHE_MS) return cached.campflow;
  try {
    const person = await campflowGet<CampflowPerson>(`${MEMBER_PERSONS}/${encodeURIComponent(id)}`);
    const email = text(person.primary_email).toLowerCase();
    const campflow = {
      id,
      ...names(person),
      email,
      adresseGeteilt: await adresseGeteilt(id, email),
    };
    rememberIch(id, campflow, now);
    return campflow;
  } catch (error: unknown) {
    if (!(error instanceof CampflowError)) throw error;
    return { id, firstName: '', lastName: '', email: '', adresseGeteilt: true };
  }
}

/** Whether another person of the member list uses the address; when unsure, it counts as shared. */
async function adresseGeteilt(id: string, email: string): Promise<boolean> {
  if (!email) return false;
  try {
    const persons = await getCampflowMembers();
    return persons.some(
      (person) => person.id !== id && text(person.primary_email).toLowerCase() === email
    );
  } catch (error: unknown) {
    if (!(error instanceof CampflowError)) throw error;
    return true;
  }
}

/**
 * The logged-in person with the name of their CampFlow person (`GET /api/intern/ich`), without
 * the address: own registrations to events are matched on the server (`eigeneAnmeldungen`).
 */
export async function getIch(
  login: string,
  now: number = Date.now(),
  timeoutMs: number = ICH_TIMEOUT_MS
): Promise<Ich> {
  const id = await getCampflowPersonId(login);
  if (!id) return { login, campflow: null };
  // Without an answer in time the ID alone; a later answer still fills the memory
  const linked = await innerhalb(ladeVerknuepfte(id, now), timeoutMs);
  return {
    login,
    campflow: { id, firstName: linked?.firstName ?? '', lastName: linked?.lastName ?? '' },
  };
}

/**
 * IDs of the persons with the primary address of the CampFlow person linked to the login, e.g.
 * own registrations to an Aktion, which CampFlow keeps as persons of their own. Only the IDs
 * leave the server. A list, even an empty one, is a checked answer that the page follows;
 * `null` means nothing could be compared (no link or address, CampFlow too slow or failing), so
 * the page falls back to the names. It only marks entries with „(ich)“ and never makes a page
 * fail.
 */
export async function eigeneAnmeldungen(
  login: string,
  persons: readonly { id: string; primary_email?: unknown; name?: unknown }[],
  now: number = Date.now(),
  timeoutMs: number = ICH_TIMEOUT_MS
): Promise<string[] | null> {
  const linked = await findVerknuepfte(login, now, timeoutMs);
  // Nothing to compare: the page falls back to the names, as without a link
  if (!linked?.email) return null;
  return mitEigenerAnmeldung(linked, persons);
}

/** The IDs of the registrations with the primary address of the linked person. */
function mitEigenerAnmeldung(
  linked: Verknuepfte,
  persons: readonly { id: string; primary_email?: unknown; name?: unknown }[]
): string[] {
  return persons
    .filter(
      (person) =>
        text(person.primary_email).toLowerCase() === linked.email &&
        // A family address is no proof: then the first name has to match as well
        (!linked.adresseGeteilt ||
          sameName(names(person as CampflowPerson).firstName, linked.firstName))
    )
    .map((p) => p.id);
}

/** How long „Meine Beiträge“ waits for the registrations to the Aktionen at most. */
export const BEITRAEGE_ANMELDUNGEN_TIMEOUT_MS = 10_000;

/** A Beitrag as `eigeneBeitraege` compares it: who pays, and the Aktion it belongs to. */
export interface BeitragZahlende {
  id: string;
  payerId: string | null;
  /** The CampFlow event of the Sammlung, null for a Mitgliedsbeitrag or a manual Sammlung. */
  eventId: string | null;
}

/**
 * Which Beiträge the login has to pay or gets paid back (`GET /api/intern/beitraege/meine`), per
 * Beitrag ID: `true` for an own one, `false` for another person's. A Mitgliedsbeitrag names the
 * person of the member list as payer, so the link decides. A Beitrag of an Aktion names the
 * registration, a person of its own (`docs/personen.md`): the server compares the addresses of
 * the registrations to the Aktion, as `eigeneAnmeldungen` does. A Beitrag the server could not
 * check (no payer ID, the Aktion did not answer in time, no address of the linked person) is left
 * out, so the page decides it by the payer's ID and name. `null`, like `eigeneAnmeldungen`, when
 * there is no link to compare with. Nothing waits past `deadline` (ms since the epoch), so the
 * page stays within the time limit of Static Web Apps (45 seconds).
 */
export async function eigeneBeitraege(
  login: string,
  fees: readonly BeitragZahlende[],
  deadline: number = Date.now() + EIGENE_BEITRAEGE_TIMEOUT_MS
): Promise<Record<string, boolean> | null> {
  // An older Playwright API sends no payer IDs: then only the names can tell
  if (!fees.some((fee) => fee.payerId)) return null;
  const now = Date.now();
  const ichTimeoutMs = Math.min(ICH_TIMEOUT_MS, deadline - now);
  if (ichTimeoutMs <= 0) return null;
  const linked = await findVerknuepfte(login, now, ichTimeoutMs);
  if (!linked) return null;

  // Without CampFlow the linked person has no address: then the Aktionen cannot be compared
  const offen = fees.filter((fee) => fee.payerId && fee.payerId !== linked.id && fee.eventId);
  const anmeldungenTimeoutMs = Math.min(BEITRAEGE_ANMELDUNGEN_TIMEOUT_MS, deadline - Date.now());
  const eventIds =
    linked.email && anmeldungenTimeoutMs > 0
      ? [...new Set(offen.map((fee) => fee.eventId as string))]
      : [];
  const anmeldungen = new Map<string, Set<string>>();
  await innerhalb(
    Promise.all(
      eventIds.map(async (eventId) => {
        try {
          const persons = await campflowGetAll<CampflowPerson>(
            `/lists/${encodeURIComponent(eventId)}/persons`
          );
          anmeldungen.set(eventId, new Set(mitEigenerAnmeldung(linked, persons)));
        } catch {
          // Without the registrations the page decides this Aktion by the names
        }
      })
    ),
    anmeldungenTimeoutMs
  );

  const ich: Record<string, boolean> = {};
  for (const fee of fees) {
    if (!fee.payerId) continue;
    if (fee.payerId === linked.id) ich[fee.id] = true;
    // Another person of the member list, even with the same name
    else if (!fee.eventId) ich[fee.id] = false;
    else {
      const eigene = anmeldungen.get(fee.eventId);
      if (eigene) ich[fee.id] = eigene.has(fee.payerId);
    }
  }
  return ich;
}

/**
 * How long pages wait for the linked person at most. Marking own entries is an extra, so it never
 * holds up an Aktion or an Abrechnung near the time limit of Static Web Apps (45 seconds).
 */
export const ICH_TIMEOUT_MS = 5000;

/** How long `eigeneBeitraege` takes at most when the caller sets no earlier deadline. */
export const EIGENE_BEITRAEGE_TIMEOUT_MS = ICH_TIMEOUT_MS + BEITRAEGE_ANMELDUNGEN_TIMEOUT_MS;

/**
 * `getVerknuepfte` for pages that only mark entries: a failure, or no answer within `timeoutMs`,
 * means no link, not an error. A load that takes longer still fills the memory for the next page.
 */
async function findVerknuepfte(
  login: string,
  now: number,
  timeoutMs: number = ICH_TIMEOUT_MS
): Promise<Verknuepfte | null> {
  try {
    return await innerhalb(getVerknuepfte(login.trim().toLowerCase(), now), timeoutMs);
  } catch {
    return null;
  }
}

/** The recipients of minutes with `ich` for the own address; the addresses are on the list anyway. */
export async function mitEigenerAdresse<T extends { email: string }>(
  login: string,
  recipients: readonly T[]
): Promise<(T & { ich?: boolean })[]> {
  // The address itself is the own one here, shared with the family or not. Without an address
  // to compare, `ich` is left out and the page falls back to the names.
  const email = (await findVerknuepfte(login, Date.now()))?.email ?? '';
  if (!email) return [...recipients];
  return recipients.map((recipient) => ({
    ...recipient,
    ich: recipient.email.trim().toLowerCase() === email,
  }));
}
