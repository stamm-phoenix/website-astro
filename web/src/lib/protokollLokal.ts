/**
 * What the Protokoll editor keeps on this device: the token of the tab for the lock, whether the
 * tab writes, and the copies of unsaved changes until the server confirms them.
 */
import { upgradeInhalt } from '../../../api/lib/protokoll-editor-model';
import type { ProtokollStand } from './protokollEditor';

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

/** What a copy keeps besides the changed minutes. */
export interface DraftMeta {
  /** Version of the minutes the changes are based on. */
  baseEtag: string;
  changedAt: string;
  /** Login of the writer, so a shared device never offers them to someone else. */
  login: string;
}

/** Changes not confirmed by the server, kept on this device until they are. */
export interface LocalDraft extends ProtokollStand, DraftMeta {}

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

/** A copy kept before #297 and #301 changed the content: brought into the current shape. */
function upgradeDraft(draft: LocalDraft): LocalDraft {
  return { ...draft, inhalt: upgradeInhalt(draft.inhalt) };
}

/** The local copy of unsaved changes of these minutes, if this user left one. */
export function readLocalDraft(id: number, login: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(`${DRAFT_KEY}${id}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) && parsed.login.toLowerCase() === login.toLowerCase()
      ? upgradeDraft(parsed)
      : null;
  } catch {
    return null;
  }
}

/**
 * Keeps unsaved changes on this device; false if the browser refused (full or blocked). Takes the
 * minutes as JSON, which the editor has at hand, so a change is serialized only once.
 */
export function writeLocalDraft(id: number, standJson: string, meta: DraftMeta): boolean {
  try {
    // Both objects joined: the same text as `JSON.stringify({ ...stand, ...meta })`
    const draft = `${standJson.slice(0, -1)},${JSON.stringify(meta).slice(1)}`;
    localStorage.setItem(`${DRAFT_KEY}${id}`, draft);
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
    if (!Array.isArray(parsed)) return [];
    // One broken copy must not hide the others
    return parsed.filter(isDraft).flatMap((draft) => {
      try {
        return [upgradeDraft(draft)];
      } catch {
        return [];
      }
    });
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

/** What to do with the copy on this device when the minutes load. */
export interface SortedDrafts {
  /** Unsaved changes based on the stored version: writing continues with them. */
  pending: LocalDraft | null;
  /** The newest copy based on an older version: the writer is asked what to do with it. */
  conflict: LocalDraft | null;
}

/**
 * Sorts the copy on this device into „continue with it“ (based on the stored version) or „ask
 * what to do“ (parked, see `parkLocalDraft`); a copy equal to the stored version is dropped.
 */
export function sortLocalDraft(
  id: number,
  login: string,
  loaded: ProtokollStand & { etag: string; status: string }
): SortedDrafts {
  const local = readLocalDraft(id, login);
  let pending: LocalDraft | null = null;
  if (local) {
    if (sameStand(local, loaded)) {
      clearLocalDraft(id);
    } else if (local.baseEtag === loaded.etag && loaded.status === 'entwurf') {
      pending = local;
    } else {
      parkLocalDraft(id, local);
    }
  }
  return { pending, conflict: readParkedDrafts(id, login)[0] ?? null };
}
