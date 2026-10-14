import type { ProtokollEditorStatus, ProtokollInhalt, ProtokollPunkt } from './types';

export { formatDateTime } from './format';

export {
  MAX_AUFGABEN,
  MAX_PUNKTE,
  MAX_TEXT,
  MAX_UNTERPUNKTE,
  REVISION_REASON_LABELS,
  SPERRE_RENEW_SECONDS,
  aktionZeitraum,
  neuerPunkt,
  parseProtokollText,
  punktNummer,
} from '../../../api/lib/protokoll-editor-model';

/** Label and tone of the review state, in the list and on the page of the minutes. */
export const PROTOKOLL_STATUS: Record<
  ProtokollEditorStatus,
  { label: string; tone: 'neutral' | 'warning' | 'success' }
> = {
  entwurf: { label: 'Entwurf', tone: 'neutral' },
  review: { label: 'Im Review', tone: 'warning' },
  freigegeben: { label: 'Freigegeben', tone: 'success' },
  verschickt: { label: 'Verschickt', tone: 'success' },
};

/**
 * Browser side of the Protokoll-Editor (#277, `docs/protokoll-editor.md`): the token of the
 * writing tab and the local copy of changes the server does not have yet.
 */

export function protokollEditorUrl(id: number, bearbeiten = false): string {
  return `/leitendenbereich/protokolle/protokoll?id=${id}${bearbeiten ? '&bearbeiten=1' : ''}`;
}

export function praesentationUrl(id: number): string {
  return `/leitendenbereich/protokolle/praesentation?id=${id}`;
}

/**
 * Opens the presentation in a window of its own, without tabs, bookmarks or menus, to move to
 * the TV or share in Teams. The same window is reused for the same minutes. Returns false if the
 * browser blocked it.
 */
export function openPraesentation(id: number): boolean {
  const width = Math.min(1600, Math.max(960, Math.round(window.screen.availWidth * 0.8)));
  const height = Math.min(1000, Math.max(640, Math.round(window.screen.availHeight * 0.8)));
  const opened = window.open(
    praesentationUrl(id),
    `protokoll-praesentation-${id}`,
    `popup=yes,width=${width},height=${height}`
  );
  opened?.focus();
  return opened !== null;
}

/** What the writing tab tells the presentation window of the same browser. */
export type PraesentationMessage =
  | {
      type: 'stand';
      title: string;
      date: string;
      inhalt: ProtokollInhalt;
      aktiverPunkt: string | null;
    }
  /** The window opened and asks for the current version. */
  | { type: 'hallo' }
  /** The tab stopped writing; the window follows the server again. */
  | { type: 'ende' };

/**
 * The channel between the writing tab and the presentation window of the same minutes. It stays
 * in this browser and stores nothing; `null` where the browser has no BroadcastChannel.
 */
export function praesentationChannel(id: number): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(`phoenix-protokoll-${id}`);
  } catch {
    return null;
  }
}

/** IDs of the agenda items (and sub-items) whose own content differs between two versions. */
export function changedPunkte(before: ProtokollInhalt, after: ProtokollInhalt): Set<string> {
  const all = (inhalt: ProtokollInhalt): ProtokollPunkt[] =>
    inhalt.punkte.flatMap((p) => [p, ...p.unterpunkte]);
  const own = (p: ProtokollPunkt): string =>
    JSON.stringify({ t: p.titel, x: p.text, a: p.aufgaben, k: p.aktion });
  const old = new Map(all(before).map((p) => [p.id, own(p)]));
  return new Set(
    all(after)
      .filter((p) => old.get(p.id) !== own(p))
      .map((p) => p.id)
  );
}

/** ID of a new agenda item or task; unique enough within one set of minutes. */
export function newElementId(): string {
  return crypto.randomUUID();
}

const TOKEN_KEY = 'phoenix:protokoll-tab:v1:';
const DRAFT_KEY = 'phoenix:protokoll-entwurf:v1:';

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Token of this tab for the lock of one set of minutes. Kept in the tab's session storage, so
 * reloading the tab keeps the lock; without storage it lasts as long as the page.
 */
export function tabToken(id: number): string {
  const key = `${TOKEN_KEY}${id}`;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored)) return stored;
    const token = randomToken();
    sessionStorage.setItem(key, token);
    return token;
  } catch {
    return randomToken();
  }
}

const WRITING_KEY = 'phoenix:protokoll-schreiben:v1:';

/** Remembers for this tab that it writes, so reloading it continues writing. */
export function rememberWriting(id: number, writing: boolean): void {
  try {
    if (writing) sessionStorage.setItem(`${WRITING_KEY}${id}`, '1');
    else sessionStorage.removeItem(`${WRITING_KEY}${id}`);
  } catch {
    // Without storage a reload opens the minutes for reading
  }
}

export function wasWriting(id: number): boolean {
  try {
    return sessionStorage.getItem(`${WRITING_KEY}${id}`) === '1';
  } catch {
    return false;
  }
}

/** What the editor saves: title, date and the document. */
export interface ProtokollStand {
  title: string;
  date: string;
  inhalt: ProtokollInhalt;
}

/** Changes not confirmed by the server, kept on this device until they are. */
export interface LocalDraft extends ProtokollStand {
  /** Version of the minutes the changes are based on. */
  baseEtag: string;
  changedAt: string;
  /** Login of the writer, so a shared device never offers them to someone else. */
  login: string;
}

function isDraft(value: unknown): value is LocalDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.title === 'string' &&
    typeof draft.date === 'string' &&
    typeof draft.baseEtag === 'string' &&
    typeof draft.changedAt === 'string' &&
    typeof draft.login === 'string' &&
    !!draft.inhalt &&
    typeof draft.inhalt === 'object'
  );
}

/** The local copy of unsaved changes of these minutes, if this user left one. */
export function readLocalDraft(id: number, login: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(`${DRAFT_KEY}${id}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) && parsed.login.toLowerCase() === login.toLowerCase() ? parsed : null;
  } catch {
    return null;
  }
}

/** Keeps unsaved changes on this device; false if the browser refused (full or blocked). */
export function writeLocalDraft(id: number, draft: LocalDraft): boolean {
  try {
    localStorage.setItem(`${DRAFT_KEY}${id}`, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalDraft(id: number): void {
  try {
    localStorage.removeItem(`${DRAFT_KEY}${id}`);
  } catch {
    // Nothing stored, or storage is blocked
  }
}

const PARKED_SUFFIX = ':geparkt';
const MAX_PARKED = 5;

function readParked(id: number): LocalDraft[] {
  try {
    const raw = localStorage.getItem(`${DRAFT_KEY}${id}${PARKED_SUFFIX}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isDraft) : [];
  } catch {
    return [];
  }
}

function writeParked(id: number, drafts: LocalDraft[]): boolean {
  try {
    const key = `${DRAFT_KEY}${id}${PARKED_SUFFIX}`;
    if (drafts.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(drafts));
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves unsaved changes that no longer fit the stored version aside, so writing on never
 * overwrites them; they stay until the writer adopts or discards them.
 */
export function parkLocalDraft(id: number, draft: LocalDraft): void {
  const parked = readParked(id).filter((d) => d.changedAt !== draft.changedAt);
  parked.push(draft);
  // The working copy goes only once the parked copy is safely stored
  if (writeParked(id, parked.slice(-MAX_PARKED))) clearLocalDraft(id);
}

/** Parked versions of this user, newest first. */
export function readParkedDrafts(id: number, login: string): LocalDraft[] {
  return readParked(id)
    .filter((d) => d.login.toLowerCase() === login.toLowerCase())
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt));
}

export function removeParkedDraft(id: number, changedAt: string): void {
  writeParked(
    id,
    readParked(id).filter((d) => d.changedAt !== changedAt)
  );
}

/** Compares two versions of the minutes by content. */
export function sameStand(a: ProtokollStand, b: ProtokollStand): boolean {
  return (
    a.title === b.title &&
    a.date === b.date &&
    JSON.stringify(a.inhalt) === JSON.stringify(b.inhalt)
  );
}

/** A deep copy that Svelte can make reactive without touching the original. */
export function copyStand(stand: ProtokollStand): ProtokollStand {
  return { title: stand.title, date: stand.date, inhalt: structuredClone(stand.inhalt) };
}

/** `HH:MM` of the current local time. */
export function currentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

const timeFormatter = new Intl.DateTimeFormat('de-DE', {
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
});
const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `19:42` in Berlin time */
export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

/** `Mittwoch, 14. Oktober 2026` for `YYYY-MM-DD` */
export function formatMeetingDate(date: string): string {
  return date ? dateFormatter.format(new Date(`${date}T00:00:00Z`)) : '';
}

/** `14.10.2026` for `YYYY-MM-DD`, empty for empty. */
export function formatShortDate(date: string): string {
  if (!date) return '';
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}
