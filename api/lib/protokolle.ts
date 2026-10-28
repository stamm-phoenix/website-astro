/**
 * Minutes of meetings (Protokolle): DOCX, PDF and TXT files in a folder of a SharePoint document library,
 * created from a template and edited in Word for the web. The review state lives in Azure SQL: Entwurf → (Review →) Freigegeben → Verschickt. Files without a status, e.g. minutes
 * from before this module, count as Archiv. Approved minutes are mailed as PDF to all current
 * leaders and to members with the label „Protokollempfang“, whose addresses come from CampFlow.
 */
import { createHash } from 'node:crypto';
import type { CampflowPerson } from './campflow';
import { campflowGetAll } from './campflow';
import { CONFIG } from './config';
import type { ClientPrincipal } from './staff-auth';
import { email } from './sammelbestellung-validation';
import { ValidationError } from './pflege-validation';
import type { ProtokollTermin } from './protokoll-termin';
import { isTerminStale, parseProtokollTermin } from './protokoll-termin';
import { protokollContentVersion } from './protokoll-content-version';

/** Values of the workflow status; files without one are shown as `Archiv`. */
export const PROTOKOLL_STATUSES = ['Entwurf', 'Review', 'Freigegeben', 'Verschickt'] as const;
export type ProtokollStatus = (typeof PROTOKOLL_STATUSES)[number] | 'Archiv';

/** Graph allows 500 recipients per mail; the sender itself is one of them. */
export const MAX_PROTOKOLL_RECIPIENTS = 450;

/** Persisted workflow fields; legacy names are retained for lossless migration. */
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
  size?: number;
  id: string;
  name: string;
  webUrl?: string;
  cTag?: string;
  /** Fingerprint of Word parts, resolved by the API when a stored version needs it. */
  contentVersion?: string;
  metadata?: { etag: string; fields: ProtokollFields };
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
  /** Combined SQL workflow version and SharePoint file version. */
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
  const base = fileName.replace(/\.(?:docx|pdf|txt)$/i, '');
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

/** Whether a drive item is a supported protocol file directly in the folder of the minutes. */
export function isProtokollFile(item: ProtokollDriveItem, folderPath: string): boolean {
  if (item.file === undefined || !/\.(?:docx|pdf|txt)$/i.test(item.name)) return false;
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
  const fields = item.metadata?.fields ?? item.listItem?.fields ?? {};
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
    etag: item.metadata?.etag ?? item.listItem?.eTag ?? '',
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
 * Every leader may review, approve and mail minutes. Approving one's own minutes needs an
 * explicit confirmation, so a second pair of eyes stays the default but is not required.
 */
export function assertOwnApprovalConfirmed(
  createdBy: string,
  principal: ClientPrincipal,
  ownConfirmed: boolean
): void {
  if (sameLogin(createdBy, principal.userDetails) && !ownConfirmed) {
    throw new ValidationError({
      form: 'Bestätige bitte, dass du dein eigenes Protokoll ohne zweite Person freigibst.',
    });
  }
}

/**
 * Throws unless the minutes may be deleted: only before they were sent. Sent and archived
 * minutes stay as a record.
 */
export function assertMayDeleteProtokoll(protokoll: StaffProtokoll): void {
  if (protokoll.status === 'Verschickt' || protokoll.status === 'Archiv' || protokoll.delivery) {
    throw new ValidationError({
      form: 'Verschickte und archivierte Protokolle bleiben erhalten.',
    });
  }
}

export type ProtokollAction = 'review' | 'approve' | 'reject' | 'reopen';

/** Column values for a change of the review state, or a validation error if it is not allowed. */
export function protokollTransition(
  protokoll: StaffProtokoll,
  action: ProtokollAction,
  principal: ClientPrincipal,
  options: { cTag: string; note: string; now: Date; ownConfirmed?: boolean }
): ProtokollFields {
  const deny = (message: string): never => {
    throw new ValidationError({ form: message });
  };

  switch (action) {
    case 'review':
      if (protokoll.status !== 'Entwurf') deny('Nur Entwürfe können zum Review gegeben werden.');
      return { Status: 'Review', Pruefnotiz: '' };
    case 'approve':
      // Drafts too: whoever is sure of their minutes approves them without a review
      if (protokoll.status !== 'Entwurf' && protokoll.status !== 'Review') {
        deny('Nur Entwürfe und Protokolle im Review können freigegeben werden.');
      }
      assertOwnApprovalConfirmed(protokoll.createdBy, principal, options.ownConfirmed === true);
      return {
        Status: 'Freigegeben',
        // A note from an earlier review is done with the approval
        Pruefnotiz: '',
        FreigegebenVon: principal.userDetails,
        FreigegebenAm: options.now.toISOString(),
        FreigabeVersion: options.cTag,
      };
    case 'reject':
      if (protokoll.status !== 'Review') deny('Nur Protokolle im Review können zurückgehen.');
      if (!options.note) {
        throw new ValidationError({ note: 'Bitte kurz schreiben, was noch fehlt.' });
      }
      return { Status: 'Entwurf', Pruefnotiz: options.note };
    case 'reopen':
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
 * Label name for comparisons: without emoji and case, but with digits and other characters, so
 * „📄 Protokollempfang“ matches and „Protokollempfang 2025“ does not.
 */
function normalizeLabel(name: string): string {
  return name
    .replace(/\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\u200D|\uFE0F/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('de');
}

/** Up to how many addresses can be added by hand for one delivery. */
export const MAX_PROTOKOLL_EXTRA_RECIPIENTS = 20;

/** A recipient from CampFlow, with the reasons shown before sending. */
export interface ProtokollRecipient {
  email: string;
  /** Names of the members with this address, e.g. „Lea Muster“. */
  name: string;
  /** Why the address is on the list, e.g. „Gruppe 🐦‍🔥 Leiter*in“ or „Label Protokollempfang“. */
  reasons: string[];
}

/** The names that match one of the normalized entries. */
function matching(
  names: unknown,
  entries: string[],
  matches: (name: string, entry: string) => boolean
): string[] {
  if (!Array.isArray(names) || entries.length === 0) return [];
  return names.filter(
    (name): name is string =>
      typeof name === 'string' && entries.some((entry) => matches(name, entry))
  );
}

function personName(person: CampflowPerson): string {
  const name = (person.name ?? {}) as { first_name?: unknown; last_name?: unknown };
  return [name.first_name, name.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map((part) => part.trim())
    .join(' ');
}

/**
 * The current members in one of the given CampFlow groups or with one of the given labels, once
 * per normalized address. Only the primary address counts: CC addresses belong to parents of
 * children.
 */
export function protokollRecipients(
  persons: CampflowPerson[],
  today: string,
  groups: string[],
  labels: string[] = []
): ProtokollRecipient[] {
  const prefixes = groups.map(normalizeGroup).filter((prefix) => prefix !== '');
  const labelNames = labels.map(normalizeLabel).filter((label) => label !== '');
  const recipients = new Map<string, { names: Set<string>; reasons: Set<string> }>();
  for (const person of persons) {
    if (typeof person.leave_date === 'string' && person.leave_date && person.leave_date <= today)
      continue;
    if (typeof person.join_date === 'string' && person.join_date > today) continue;
    const reasons = [
      ...matching(person.group_names, prefixes, (name, prefix) =>
        normalizeGroup(name).startsWith(prefix)
      ).map((name) => `Gruppe ${name.trim()}`),
      ...matching(
        person.label_names,
        labelNames,
        (name, label) => normalizeLabel(name) === label
      ).map((name) => `Label ${name.trim()}`),
    ];
    if (reasons.length === 0 || typeof person.primary_email !== 'string') continue;
    let address: string;
    try {
      address = email(person.primary_email);
    } catch {
      /* Skip invalid contact fields, never guess addresses. */
      continue;
    }
    const entry = recipients.get(address) ?? { names: new Set(), reasons: new Set() };
    const name = personName(person);
    if (name) entry.names.add(name);
    for (const reason of reasons) entry.reasons.add(reason);
    recipients.set(address, entry);
  }
  if (recipients.size > MAX_PROTOKOLL_RECIPIENTS) {
    throw new ValidationError({
      form: `Mehr als ${MAX_PROTOKOLL_RECIPIENTS} Empfänger*innen. Bitte die Gruppen und Labels in der Konfiguration prüfen.`,
    });
  }
  return [...recipients]
    .map(([address, entry]) => ({
      email: address,
      name: [...entry.names].join(', '),
      reasons: [...entry.reasons],
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * How many current members of the given CampFlow groups have no usable primary address, so
 * they cannot get a mail. Counted per person; they are reported, never guessed.
 */
export function membersWithoutAddress(
  persons: CampflowPerson[],
  today: string,
  groups: string[]
): number {
  const prefixes = groups.map(normalizeGroup).filter((prefix) => prefix !== '');
  let count = 0;
  for (const person of persons) {
    if (typeof person.leave_date === 'string' && person.leave_date && person.leave_date <= today)
      continue;
    if (typeof person.join_date === 'string' && person.join_date > today) continue;
    const inGroup =
      matching(person.group_names, prefixes, (name, prefix) =>
        normalizeGroup(name).startsWith(prefix)
      ).length > 0;
    if (!inGroup) continue;
    try {
      email(person.primary_email);
    } catch {
      count++;
    }
  }
  return count;
}

/**
 * Current leaders and members with a recipient label from the CampFlow member list; throws
 * `CampflowError` if it fails.
 */
export async function loadProtokollRecipients(): Promise<ProtokollRecipient[]> {
  const persons = await campflowGetAll<CampflowPerson>('/lists/member/persons');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
  return protokollRecipients(
    persons,
    today,
    CONFIG.protokolle.campflowGroups,
    CONFIG.protokolle.campflowLabels
  );
}

function addressList(value: unknown, field: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError({ form: `Ungültige Liste ${field}.` });
  return value;
}

/**
 * The addresses of one delivery: the CampFlow list without the addresses taken out and with the
 * addresses added by hand, once each. Taken-out addresses that are not on the list are ignored.
 */
export function protokollDeliveryAddresses(
  recipients: ProtokollRecipient[],
  excludedInput: unknown,
  extraInput: unknown
): string[] {
  const excluded = new Set(
    addressList(excludedInput, 'excluded')
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
  );
  const extras = addressList(extraInput, 'extra');
  if (extras.length > MAX_PROTOKOLL_EXTRA_RECIPIENTS) {
    throw new ValidationError({
      form: `Du kannst höchstens ${MAX_PROTOKOLL_EXTRA_RECIPIENTS} weitere Adressen eintragen.`,
    });
  }
  const addresses = new Set(
    recipients.map((recipient) => recipient.email).filter((address) => !excluded.has(address))
  );
  for (const value of extras) {
    try {
      addresses.add(email(value));
    } catch {
      throw new ValidationError({
        form: `„${typeof value === 'string' ? value : ''}“ ist keine gültige E-Mail-Adresse. Bitte korrigiere oder entferne sie.`,
      });
    }
  }
  if (addresses.size > MAX_PROTOKOLL_RECIPIENTS) {
    throw new ValidationError({
      form: `Mehr als ${MAX_PROTOKOLL_RECIPIENTS} Empfänger*innen. Bitte nimm Adressen heraus.`,
    });
  }
  return [...addresses].sort();
}

/** Binds the confirmation to the exact addresses from CampFlow. */
export function audienceVersion(recipients: ProtokollRecipient[]): string {
  const addresses = recipients.map((recipient) => recipient.email);
  return createHash('sha256').update(JSON.stringify(addresses)).digest('hex');
}

/** `YYYY-MM-DD` → `DD.MM.YYYY`. */
export function formatGermanDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}.${month}.${year}` : iso;
}
