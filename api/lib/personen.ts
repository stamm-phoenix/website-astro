import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type { CampflowPerson } from './campflow';
import { CampflowError, campflowGet, campflowGetAll } from './campflow';
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
}

/** Deletes a person if it still has the version `etag`; old minutes keep the name. */
export async function deletePerson(id: number, etag: string): Promise<void> {
  const result = await getDb()
    .deleteFrom('organisation.person')
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) await notChanged(id);
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
  return (await campflowGetAll<CampflowPerson>(MEMBER_PERSONS))
    .filter((person) => typeof person.id === 'string')
    .map((person) => toCampflowMitglied(person, today))
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de')
    );
}

/** The list with the Entra group and the CampFlow member list; a failing source is `null`. */
export async function getPersonenUebersicht(): Promise<PersonenUebersicht> {
  const [personen, leitende, campflow] = await Promise.all([
    getPersonen(),
    getTaskDirectoryUsers().then(
      (users) => users.map(({ login, name }) => ({ login, name })),
      () => null
    ),
    getCampflowMitglieder().catch((error: unknown) => {
      if (error instanceof CampflowError) return null;
      throw error;
    }),
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

const ICH_CACHE_MS = 10 * 60_000;
const ichCache = new Map<string, { at: number; campflow: NonNullable<Ich['campflow']> }>();

/**
 * The logged-in person with name and primary address of their CampFlow person, so pages can
 * recognize their registrations to events, which CampFlow keeps as persons of their own. If
 * CampFlow fails, the ID alone is returned.
 */
export async function getIch(login: string, now: number = Date.now()): Promise<Ich> {
  const id = await getCampflowPersonId(login);
  if (!id) return { login, campflow: null };
  const cached = ichCache.get(id);
  if (cached && now - cached.at < ICH_CACHE_MS) return { login, campflow: cached.campflow };
  try {
    const person = await campflowGet<CampflowPerson>(`${MEMBER_PERSONS}/${encodeURIComponent(id)}`);
    const campflow = { id, ...names(person), email: text(person.primary_email).toLowerCase() };
    ichCache.set(id, { at: now, campflow });
    return { login, campflow };
  } catch (error: unknown) {
    if (!(error instanceof CampflowError)) throw error;
    return { login, campflow: { id, firstName: '', lastName: '', email: '' } };
  }
}
