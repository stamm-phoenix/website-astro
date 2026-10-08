/**
 * Attendance in the Gruppenstunden (#217, `docs/anwesenheit.md`): per Stufe and date, which
 * children of the CampFlow member list were there, plus guests and what the group did. Stored
 * in Azure SQL (`gruppenstunde.*`, migration `0004_anwesenheit.sql`); children only by their
 * CampFlow ID, their names come from CampFlow when a Termin is shown.
 */
import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import type { CampflowPerson } from './campflow';
import { campflowGetAll } from './campflow';
import { CONFIG } from './config';
import type { Db } from './db';
import {
  VersionConflictError,
  getDb,
  inTransaction,
  lockResource,
  toDateString,
  toVersion,
} from './db';
import type { Database } from './db-schema';
import type { Leitende } from './leitende-list';
import { toStufenMember } from './nikolaus-stufen';
import { STUFEN } from './pflege-validation';

/** URL names of the Stufen, so routes need no umlauts. */
export const STUFE_SLUGS: Record<string, string> = {
  woelflinge: 'Wölflinge',
  jungpfadfinder: 'Jungpfadfinder',
  pfadfinder: 'Pfadfinder',
  rover: 'Rover',
};

export function stufeFromSlug(slug: string | undefined): string | undefined {
  return slug !== undefined && Object.hasOwn(STUFE_SLUGS, slug) ? STUFE_SLUGS[slug] : undefined;
}

export function slugOfStufe(stufe: string): string {
  return Object.keys(STUFE_SLUGS).find((slug) => STUFE_SLUGS[slug] === stufe) ?? '';
}

/** Format of a CampFlow person ID, e.g. `per_AbC123`. */
export const PERSON_ID_PATTERN = /^per_[A-Za-z0-9]{1,60}$/;

const BERLIN_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today as `YYYY-MM-DD` in Europe/Berlin, where the Gruppenstunden take place. */
export function berlinToday(now: Date = new Date()): string {
  return BERLIN_DATE.format(now);
}

/**
 * The first date whose attendance still names the children. Older Termine keep only the
 * counts and can no longer be changed.
 */
export function retentionStart(now: Date = new Date()): string {
  const [year, month, day] = berlinToday(now).split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1 - CONFIG.anwesenheit.retentionMonths, day));
  return start.toISOString().slice(0, 10);
}

/** Removes CampFlow IDs and guest names of Termine before the retention start. */
export async function anonymizeExpired(now: Date = new Date()): Promise<number> {
  const result = await getDb()
    .updateTable('gruppenstunde.attendance')
    .set({ person_id: null, guest_name: null })
    .where((eb) => eb.or([eb('person_id', 'is not', null), eb('guest_name', 'is not', null)]))
    .where('meeting_id', 'in', (eb) =>
      eb
        .selectFrom('gruppenstunde.meeting')
        .select('id')
        .where('date', '<', retentionStart(now))
    )
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

// --- Reading ---

/** A Termin in the overview and the statistics. */
export interface MeetingSummary {
  stufe: string;
  date: string;
  /** Children of the member list who were there, including anonymized ones. */
  members: number;
  guests: number;
  notes: string;
}

/** All Termine with the number of children who were there, newest first. */
export async function getMeetingSummaries(): Promise<MeetingSummary[]> {
  const rows = await getDb()
    .selectFrom('gruppenstunde.meeting as m')
    .leftJoin('gruppenstunde.attendance as a', 'a.meeting_id', 'm.id')
    .select([
      'm.stufe',
      'm.date',
      'm.notes',
      sql<number>`SUM(CASE WHEN a.guest = 0 THEN 1 ELSE 0 END)`.as('members'),
      sql<number>`SUM(CASE WHEN a.guest = 1 THEN 1 ELSE 0 END)`.as('guests'),
    ])
    .groupBy(['m.id', 'm.stufe', 'm.date', 'm.notes'])
    .orderBy('m.date', 'desc')
    .orderBy('m.stufe')
    .execute();
  return rows.map((row) => ({
    stufe: row.stufe,
    date: toDateString(row.date),
    members: Number(row.members),
    guests: Number(row.guests),
    notes: row.notes,
  }));
}

export interface Guest {
  id: string;
  name: string;
}

/** What is recorded for one Termin; an unrecorded Termin has no etag and nobody present. */
export interface MeetingRecord {
  /** Version of the notes, `null` while the Termin does not exist yet. */
  etag: string | null;
  notes: string;
  presentIds: string[];
  /** Children who were there, whose IDs were removed after the retention period. */
  anonymized: number;
  guests: Guest[];
  /** Guests whose names were removed after the retention period. */
  anonymizedGuests: number;
}

export async function getMeetingRecord(termin: Termin): Promise<MeetingRecord> {
  const meeting = await getDb()
    .selectFrom('gruppenstunde.meeting')
    .select(['id', 'version', 'notes'])
    .where('stufe', '=', termin.stufe)
    .where('date', '=', termin.date)
    .executeTakeFirst();
  if (!meeting) {
    return { etag: null, notes: '', presentIds: [], anonymized: 0, guests: [], anonymizedGuests: 0 };
  }
  const rows = await getDb()
    .selectFrom('gruppenstunde.attendance')
    .select(['id', 'guest', 'person_id', 'guest_name'])
    .where('meeting_id', '=', meeting.id)
    .orderBy('id')
    .execute();
  const named = rows.filter((row) => row.guest && row.guest_name !== null);
  return {
    etag: toVersion(meeting.version),
    notes: meeting.notes,
    presentIds: rows.flatMap((row) => (row.person_id === null ? [] : [row.person_id])),
    anonymized: rows.filter((row) => !row.guest && row.person_id === null).length,
    guests: named.map((row) => ({ id: String(row.id), name: row.guest_name ?? '' })),
    anonymizedGuests: rows.filter((row) => row.guest && row.guest_name === null).length,
  };
}

// --- Writing ---

/** One Gruppenstunde: a Stufe on a date (`YYYY-MM-DD`). */
export interface Termin {
  stufe: string;
  date: string;
}

function meetingIdOf(db: Db, termin: Termin) {
  return db
    .selectFrom('gruppenstunde.meeting')
    .select('id')
    .where('stufe', '=', termin.stufe)
    .where('date', '=', termin.date);
}

/**
 * Runs `work` in a transaction that holds the lock of the Termin, with the ID of the Termin;
 * creates the Termin first if needed.
 */
function withMeeting<T>(
  termin: Termin,
  actor: string,
  work: (trx: Transaction<Database>, meetingId: number) => Promise<T>
): Promise<T> {
  return inTransaction(async (trx) => {
    await lockResource(trx, `gruppenstunde:${termin.stufe}:${termin.date}`);
    const existing = await meetingIdOf(trx, termin).executeTakeFirst();
    const meetingId =
      existing?.id ??
      (
        await trx
          .insertInto('gruppenstunde.meeting')
          .values({ stufe: termin.stufe, date: termin.date, updated_by: actor })
          .output('inserted.id')
          .executeTakeFirstOrThrow()
      ).id;
    return work(trx, meetingId);
  });
}

/** Marks a child as present or not; repeating a call changes nothing. */
export async function setPresent(
  termin: Termin,
  personId: string,
  present: boolean,
  actor: string
): Promise<void> {
  if (!present) {
    await getDb()
      .deleteFrom('gruppenstunde.attendance')
      .where('person_id', '=', personId)
      .where('meeting_id', 'in', meetingIdOf(getDb(), termin))
      .execute();
    return;
  }
  await withMeeting(termin, actor, async (trx, meetingId) => {
    const existing = await trx
      .selectFrom('gruppenstunde.attendance')
      .select('id')
      .where('meeting_id', '=', meetingId)
      .where('person_id', '=', personId)
      .executeTakeFirst();
    if (existing) return;
    await trx
      .insertInto('gruppenstunde.attendance')
      .values({ meeting_id: meetingId, guest: false, person_id: personId, guest_name: null })
      .execute();
  });
}

export async function addGuest(termin: Termin, name: string, actor: string): Promise<Guest> {
  return withMeeting(termin, actor, async (trx, meetingId) => {
    const { id } = await trx
      .insertInto('gruppenstunde.attendance')
      .values({ meeting_id: meetingId, guest: true, person_id: null, guest_name: name })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    return { id: String(id), name };
  });
}

/** Removes a guest of the Termin; a guest that is already gone is fine. */
export async function removeGuest(termin: Termin, id: number): Promise<void> {
  await getDb()
    .deleteFrom('gruppenstunde.attendance')
    .where('id', '=', id)
    .where('guest', '=', true)
    .where('meeting_id', 'in', meetingIdOf(getDb(), termin))
    .execute();
}

/**
 * Saves what the group did. `etag` is the version the editor loaded, `null` if the Termin did
 * not exist then; without one the notes are only written while nobody else has written any.
 * Returns the new version.
 */
export async function saveNotes(
  termin: Termin,
  notes: string,
  etag: string | null,
  actor: string
): Promise<string> {
  return withMeeting(termin, actor, async (trx, meetingId) => {
    const current = await trx
      .selectFrom('gruppenstunde.meeting')
      .select(['version', 'notes'])
      .where('id', '=', meetingId)
      .executeTakeFirstOrThrow();
    const unchanged = etag === null ? current.notes === '' : etag === toVersion(current.version);
    if (!unchanged) throw new VersionConflictError();
    const updated = await trx
      .updateTable('gruppenstunde.meeting')
      .set({ notes, updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
      .output('inserted.version')
      .where('id', '=', meetingId)
      .executeTakeFirstOrThrow();
    return toVersion(updated.version);
  });
}

// --- CampFlow ---

/** A child of the CampFlow member list. */
export interface Child {
  id: string;
  firstName: string;
  lastName: string;
  stufen: string[];
}

/** Current members of the CampFlow member list that belong to a Stufe. */
export async function getChildren(now: Date = new Date()): Promise<Child[]> {
  const persons = await campflowGetAll<CampflowPerson>('/lists/member/persons');
  const today = now.toISOString().slice(0, 10);
  return persons.flatMap((person) => {
    const member = toStufenMember(person, today);
    if (!member || typeof person.id !== 'string') return [];
    return [
      { id: person.id, firstName: member.firstName, lastName: member.lastName, stufen: member.stufen },
    ];
  });
}

// --- Suggested Stufe ---

/** Words of a name or login for a loose comparison („Jörg Müller-Lüdenscheidt“ → joerg, …). */
export function nameWords(name: string): string[] {
  return name
    .toLocaleLowerCase('de')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/)
    .filter((word) => word.length > 0);
}

/**
 * The Stufen the logged-in person leads according to the list „Leitende & Teams“, matched
 * loosely by name: every word of the display name, or of the login before the `@`
 * (`vorname.nachname@…`), has to appear in the name of the Leitende. Only a suggestion, as
 * people help out in other Stufen; everyone may record every Stufe.
 */
export function ownStufen(
  login: string,
  displayName: string | undefined,
  leitende: Leitende[]
): string[] {
  const candidates = [displayName ?? '', login.split('@')[0]]
    .map(nameWords)
    .filter((words) => words.length >= 2);
  const matches = leitende.filter((person) => {
    const words = new Set(nameWords(person.name));
    return candidates.some((candidate) => candidate.every((word) => words.has(word)));
  });
  const teams = new Set(matches.flatMap((person) => person.teams));
  return STUFEN.filter((stufe) => teams.has(stufe));
}
