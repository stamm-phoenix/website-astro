/**
 * The next Leitendenrunde as far as reminders are concerned: the date in the newest approved
 * minutes. Minutes from the editor carry it in the field „Nächste Leitendenrunde“ and count as
 * soon as they are approved; Word minutes only with a date a leader confirmed. Drafts and
 * minutes in review never count, and neither does a rejected or missing date. Only the newest
 * approved minutes decide, so a date from older minutes does not come back after a cancellation.
 */
import { createHash } from 'node:crypto';
import { CONFIG } from './config';
import { getDb } from './db';
import { localDateTimeToDate } from './nikolaus-config';
import { parseProtokollTermin } from './protokoll-termin';
import type { ProtokollFields } from './protokolle';

export interface Sitzung {
  /** Which minutes the date comes from: `editor:<id>` or `word:<file>`. */
  ref: string;
  /** `YYYY-MM-DD` in Berlin. */
  date: string;
  /** `HH:MM` in Berlin, if known. */
  time: string | null;
  place: string | null;
  /** Protected link to the minutes in the Leitendenbereich. */
  url: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const APPROVED_WORD = ['Freigegeben', 'Verschickt'];

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : null;
}

/** The field „Nächste Leitendenrunde“ of editor minutes; `null` if there is no valid date. */
export function editorSitzung(id: number, content: string): Sitzung | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const next = (parsed as { naechsteSitzung?: Record<string, unknown> } | null)?.naechsteSitzung;
  if (!next || !isDate(next.datum)) return null;
  return {
    ref: `editor:${id}`,
    date: next.datum,
    time: typeof next.uhrzeit === 'string' && TIME.test(next.uhrzeit) ? next.uhrzeit : null,
    place: text(next.ort),
    url: `${CONFIG.leitendenrundeReminders.siteUrl}/leitendenbereich/protokolle/protokoll?id=${id}`,
  };
}

/**
 * The date a leader confirmed for approved Word minutes. A suggestion, a rejection or a date
 * read from another version than the approved one gives `null`.
 */
export function wordSitzung(itemId: string, fields: ProtokollFields): Sitzung | null {
  const termin = parseProtokollTermin(fields.Termin);
  if (termin?.decision !== 'bestaetigt' || !termin.confirmed) return null;
  if (termin.sourceVersion !== (fields.FreigabeVersion ?? '')) return null;
  return {
    ref: `word:${itemId}`.slice(0, 80),
    date: termin.confirmed.date,
    time: termin.confirmed.time,
    place: termin.confirmed.place,
    url: `${CONFIG.leitendenrundeReminders.siteUrl}/leitendenbereich/protokolle`,
  };
}

/** Identifies the meeting itself: another date or time is another meeting with its own reminders. */
export function sitzungKey(sitzung: Pick<Sitzung, 'date' | 'time'>): string {
  return sitzung.time ? `${sitzung.date}T${sitzung.time}` : sitzung.date;
}

/** After this no reminder goes out: the start of the meeting, without a time the end of that day. */
export function sitzungEnd(sitzung: Pick<Sitzung, 'date' | 'time'>): Date {
  return localDateTimeToDate(sitzung.date, sitzung.time ?? '23:59');
}

function offsetDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * The stage (days before the meeting) that applies now: the latest one whose time has come,
 * while the meeting has not started. A date confirmed late therefore gets one reminder at once
 * and never several for stages that have passed. `null` before the first stage and after the
 * start.
 */
export function reminderStage(sitzung: Sitzung, now: Date): number | null {
  const end = sitzungEnd(sitzung);
  if (now >= end) return null;
  const hour = `${String(CONFIG.leitendenrundeReminders.startHour).padStart(2, '0')}:00`;
  const stages = [...CONFIG.leitendenrundeReminders.daysBefore].sort((a, b) => b - a);
  let current: number | null = null;
  for (const days of stages) {
    if (now >= localDateTimeToDate(offsetDay(sitzung.date, -days), hour)) current = days;
  }
  return current;
}

/** The meeting the reminders are about, or `null` if there is none. */
export async function currentSitzung(): Promise<Sitzung | null> {
  const db = getDb();
  const editor = await db
    .selectFrom('protokoll.protokoll')
    .select(['id', 'content', 'approved_at'])
    .where('status', 'in', ['freigegeben', 'verschickt'])
    .where('approved_at', 'is not', null)
    .orderBy('approved_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const word = await db
    .selectFrom('organisation.protokoll')
    .select(['drive_id', 'item_id', 'fields'])
    .execute();

  let newest: { at: number; sitzung: Sitzung | null } | null = null;
  if (editor?.approved_at)
    newest = {
      at: editor.approved_at.getTime(),
      sitzung: editorSitzung(editor.id, editor.content),
    };
  for (const row of word) {
    let fields: ProtokollFields;
    try {
      fields = JSON.parse(row.fields) as ProtokollFields;
    } catch {
      continue;
    }
    if (!APPROVED_WORD.includes(fields.Status ?? '')) continue;
    const at = Date.parse(fields.FreigegebenAm ?? '');
    if (Number.isNaN(at) || (newest && at <= newest.at)) continue;
    const key = createHash('sha256').update(`${row.drive_id}|${row.item_id}`).digest('hex');
    newest = { at, sitzung: wordSitzung(key.slice(0, 32), fields) };
  }
  return newest?.sitzung ?? null;
}
