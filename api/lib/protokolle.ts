/**
 * Minutes of meetings (Protokolle): Word files in a folder of a SharePoint document library,
 * created from a template and edited in Word for the web. The review state lives in columns of
 * the library: Entwurf → Review → Freigegeben → Verschickt. Files without a status, e.g. minutes
 * from before this module, count as Archiv. Approved minutes are mailed as PDF to all current
 * leaders, whose addresses come from CampFlow.
 */
import { createHash } from 'node:crypto';
import type { CampflowPerson } from './campflow';
import { CONFIG } from './config';
import type { ClientPrincipal } from './staff-auth';
import { email } from './sammelbestellung-validation';
import { ValidationError } from './pflege-validation';
import type { ProtokollTermin } from './protokoll-termin';
import { isTerminStale, parseProtokollTermin } from './protokoll-termin';
import { protokollContentVersion } from './protokoll-content-version';

/** Values of the Status column; files without one are shown as `Archiv`. */
export const PROTOKOLL_STATUSES = ['Entwurf', 'Review', 'Freigegeben', 'Verschickt'] as const;
export type ProtokollStatus = (typeof PROTOKOLL_STATUSES)[number] | 'Archiv';

/** Graph allows 500 recipients per mail; the sender itself is one of them. */
export const MAX_PROTOKOLL_RECIPIENTS = 450;

/** Library columns (internal names) that hold the review state. */
export interface ProtokollFields {
  Status?: string;
  ErstelltVon?: string;
  Pruefnotiz?: string;
  FreigegebenVon?: string;
  FreigegebenAm?: string;
  FreigabeVersion?: string;
  Versand?: string;
  /** The next meeting read from the approved file, JSON (see `protokoll-termin.ts`). */
  Termin?: string;
}

/** A drive item of the library as returned by Graph with `listItem($expand=fields)`. */
export interface ProtokollDriveItem {
  id: string;
  name: string;
  webUrl?: string;
  cTag?: string;
  /** Fingerprint of Word parts, resolved by the API when a stored version needs it. */
  contentVersion?: string;
  file?: { mimeType?: string };
  /** `path` looks like `/drives/<id>/root:/Protokolle/Sitzungen`. */
  parentReference?: { path?: string };
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string } };
  listItem?: { eTag?: string; fields?: ProtokollFields };
}

/**
 * The mailing of approved minutes. `attempted` is stored before the mail goes out; if it stays,
 * the result is unknown and a resend needs a deliberate confirmation.
 */
export interface ProtokollDelivery {
  state: 'attempted' | 'sent';
  recipients: number;
  at: string;
  by: string;
}

/** Minutes as sent to the Leitendenbereich. */
export interface StaffProtokoll {
  id: string;
  /** Version of the library item; changes with every edit of the file, too. */
  etag: string;
  fileName: string;
  title: string;
  /** Date of the meeting, `YYYY-MM-DD`, or empty if the file name has none. */
  date: string;
  status: ProtokollStatus;
  webUrl: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  /** Why a reviewer sent the minutes back. */
  reviewNote: string;
  approvedBy: string;
  approvedAt: string;
  /** The file was edited after the approval, so it must be reviewed again before sending. */
  changedSinceApproval: boolean;
  delivery: ProtokollDelivery | null;
  /** The next meeting: suggestion read from the approved file and the reviewer's decision. */
  termin: ProtokollTermin | null;
  /** The suggestion belongs to another version than the approved one, or the file changed. */
  terminStale: boolean;
}

const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;
const GERMAN_DATE = /(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/;

/**
 * Title and date from a file name like „2026-10-07 Leitendenrunde.docx“. Older names with the
 * date elsewhere, also as „07.10.2026“, are understood, too.
 */
export function parseProtokollFileName(fileName: string): { date: string; title: string } {
  const base = fileName.replace(/\.docx$/i, '');
  let date = '';
  let rest = base;
  const iso = ISO_DATE.exec(base);
  const german = iso ? null : GERMAN_DATE.exec(base);
  if (iso) {
    date = iso[0];
    rest = base.replace(iso[0], ' ');
  } else if (german) {
    const year = german[3].length === 2 ? `20${german[3]}` : german[3];
    date = `${year}-${german[2].padStart(2, '0')}-${german[1].padStart(2, '0')}`;
    rest = base.replace(german[0], ' ');
  }
  const title = rest.replace(/^[\s_\-–,]+|[\s_\-–,]+$/g, '').replace(/\s+/g, ' ');
  return { date, title: title || base };
}

/** File name for new minutes. */
export function protokollFileName(date: string, title: string): string {
  return `${date} ${title}.docx`;
}

function toStatus(value: string | undefined): ProtokollStatus {
  return (PROTOKOLL_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as ProtokollStatus)
    : 'Archiv';
}

/** Reads the stored mailing state; unreadable values count as an unknown attempt. */
export function parseDelivery(value: string | undefined): ProtokollDelivery | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ProtokollDelivery>;
    return {
      state: parsed.state === 'sent' ? 'sent' : 'attempted',
      recipients: typeof parsed.recipients === 'number' ? parsed.recipients : 0,
      at: typeof parsed.at === 'string' ? parsed.at : '',
      by: typeof parsed.by === 'string' ? parsed.by : '',
    };
  } catch {
    return { state: 'attempted', recipients: 0, at: '', by: '' };
  }
}

/** Whether a drive item is a Word file directly in the folder of the minutes. */
export function isProtokollFile(item: ProtokollDriveItem, folderPath: string): boolean {
  if (item.file === undefined || !/\.docx$/i.test(item.name)) return false;
  let parent: string;
  try {
    parent = decodeURIComponent(item.parentReference?.path ?? '');
  } catch {
    return false;
  }
  const folder = folderPath.replace(/^\/+|\/+$/g, '');
  return parent.toLowerCase().endsWith(`root:/${folder}`.toLowerCase());
}

export function toStaffProtokoll(item: ProtokollDriveItem): StaffProtokoll {
  const fields = item.listItem?.fields ?? {};
  const status = toStatus(fields.Status);
  const { date, title } = parseProtokollFileName(item.name);
  const changedSinceApproval =
    (status === 'Freigegeben' || status === 'Verschickt') &&
    (fields.FreigabeVersion ?? '') !== protokollContentVersion(item, fields.FreigabeVersion);
  const termin = parseProtokollTermin(fields.Termin);
  // Archived files were never approved, so their suggestion belongs to the file as it is now
  const referenceVersion =
    status === 'Archiv'
      ? protokollContentVersion(item, termin?.sourceVersion)
      : (fields.FreigabeVersion ?? '');
  return {
    id: item.id,
    etag: item.listItem?.eTag ?? '',
    fileName: item.name,
    title,
    date,
    status,
    webUrl: item.webUrl ?? '',
    createdBy: fields.ErstelltVon ?? '',
    lastModifiedAt: item.lastModifiedDateTime ?? '',
    lastModifiedBy: item.lastModifiedBy?.user?.displayName ?? '',
    reviewNote: fields.Pruefnotiz ?? '',
    approvedBy: fields.FreigegebenVon ?? '',
    approvedAt: fields.FreigegebenAm ?? '',
    changedSinceApproval,
    delivery: parseDelivery(fields.Versand),
    termin,
    terminStale: isTerminStale(termin, referenceVersion, changedSinceApproval),
  };
}

function sameLogin(a: string, b: string): boolean {
  return a !== '' && a.toLowerCase() === b.toLowerCase();
}

/**
 * Whether the user may approve, send back and mail minutes. `CONFIG.protokolle.reviewers` lists
 * the logins (e.g. the Vorstand); without any every leader may review.
 */
export function isProtokollReviewer(principal: ClientPrincipal): boolean {
  const reviewers = CONFIG.protokolle.reviewers;
  return (
    reviewers.length === 0 || reviewers.some((login) => sameLogin(login, principal.userDetails))
  );
}

/**
 * Throws unless the user may delete the minutes: only before they were sent, and only the
 * author or a reviewer. Sent and archived minutes stay as a record.
 */
export function assertMayDeleteProtokoll(
  protokoll: StaffProtokoll,
  principal: ClientPrincipal
): void {
  if (protokoll.status === 'Verschickt' || protokoll.status === 'Archiv' || protokoll.delivery) {
    throw new ValidationError({
      form: 'Verschickte und archivierte Protokolle bleiben erhalten.',
    });
  }
  if (!isProtokollReviewer(principal) && !sameLogin(protokoll.createdBy, principal.userDetails)) {
    throw new ValidationError({
      form: 'Löschen dürfen nur die Reviewer*innen oder wer das Protokoll angelegt hat.',
    });
  }
}

export type ProtokollAction = 'review' | 'approve' | 'reject' | 'reopen';

/** Column values for a change of the review state, or a validation error if it is not allowed. */
export function protokollTransition(
  protokoll: StaffProtokoll,
  action: ProtokollAction,
  principal: ClientPrincipal,
  options: { cTag: string; note: string; now: Date }
): ProtokollFields {
  const reviewer = isProtokollReviewer(principal);
  const deny = (message: string): never => {
    throw new ValidationError({ form: message });
  };

  switch (action) {
    case 'review':
      if (protokoll.status !== 'Entwurf') deny('Nur Entwürfe können zum Review gegeben werden.');
      return { Status: 'Review', Pruefnotiz: '' };
    case 'approve':
      if (!reviewer) deny('Freigeben dürfen nur die eingetragenen Reviewer*innen.');
      if (protokoll.status !== 'Review')
        deny('Nur Protokolle im Review können freigegeben werden.');
      // Four-eyes principle: whoever created the minutes does not approve them
      if (sameLogin(protokoll.createdBy, principal.userDetails)) {
        deny('Das eigene Protokoll muss jemand anderes freigeben.');
      }
      return {
        Status: 'Freigegeben',
        FreigegebenVon: principal.userDetails,
        FreigegebenAm: options.now.toISOString(),
        FreigabeVersion: options.cTag,
      };
    case 'reject':
      if (!reviewer) deny('Zurückgeben dürfen nur die eingetragenen Reviewer*innen.');
      if (protokoll.status !== 'Review') deny('Nur Protokolle im Review können zurückgehen.');
      if (!options.note) {
        throw new ValidationError({ note: 'Bitte kurz schreiben, was noch fehlt.' });
      }
      return { Status: 'Entwurf', Pruefnotiz: options.note };
    case 'reopen':
      if (!reviewer && !sameLogin(protokoll.createdBy, principal.userDetails)) {
        deny('Das dürfen nur die Reviewer*innen oder wer das Protokoll angelegt hat.');
      }
      if (protokoll.status !== 'Freigegeben') {
        deny(
          'Nur freigegebene, noch nicht verschickte Protokolle können wieder bearbeitet werden.'
        );
      }
      if (protokoll.delivery) deny('Der Versand wurde schon gestartet.');
      return {
        Status: 'Entwurf',
        FreigegebenVon: '',
        FreigegebenAm: '',
        FreigabeVersion: '',
        // The next date is read again from the version approved next. Only written when set,
        // so reopening keeps working in a library without the column.
        ...(protokoll.termin ? { Termin: '' } : {}),
      };
  }
}

/** Group name for comparisons: letters and spaces only, lower case. */
function normalizeGroup(name: string): string {
  return name
    .replace(/[^\p{L}\s]/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('de');
}

/**
 * Addresses of the current members in one of the given CampFlow groups, once per normalized
 * address. Only the primary address counts: CC addresses belong to parents of children.
 */
export function protokollRecipients(
  persons: CampflowPerson[],
  today: string,
  groups: string[]
): string[] {
  const prefixes = groups.map(normalizeGroup).filter((prefix) => prefix !== '');
  const addresses = new Set<string>();
  for (const person of persons) {
    if (typeof person.leave_date === 'string' && person.leave_date && person.leave_date <= today)
      continue;
    if (typeof person.join_date === 'string' && person.join_date > today) continue;
    const names = Array.isArray(person.group_names) ? person.group_names : [];
    const isLeader = names.some(
      (name) =>
        typeof name === 'string' &&
        prefixes.some((prefix) => normalizeGroup(name).startsWith(prefix))
    );
    if (!isLeader || typeof person.primary_email !== 'string') continue;
    try {
      addresses.add(email(person.primary_email));
    } catch {
      /* Skip invalid contact fields, never guess addresses. */
    }
  }
  if (addresses.size > MAX_PROTOKOLL_RECIPIENTS) {
    throw new ValidationError({
      form: `Mehr als ${MAX_PROTOKOLL_RECIPIENTS} Empfänger*innen. Bitte die Gruppen in der Konfiguration prüfen.`,
    });
  }
  return [...addresses].sort();
}

/** Binds the confirmation to the exact list of recipients, without exposing addresses. */
export function audienceVersion(addresses: string[]): string {
  return createHash('sha256').update(JSON.stringify(addresses)).digest('hex');
}

/** `YYYY-MM-DD` → `DD.MM.YYYY`. */
export function formatGermanDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}.${month}.${year}` : iso;
}
