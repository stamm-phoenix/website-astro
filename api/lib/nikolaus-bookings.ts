import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { listNikolausStates, mutateNikolausState, readNikolausState } from './nikolaus-state';
import {
  createSharePointListItemWithVersion,
  getGraphStatus,
  deleteSharePointListItem,
  getSharePointListItem,
  getSharePointListItems,
  updateSharePointListItem,
} from './sharepoint-data-access';
import { EnvironmentVariable, getEnvironment } from './environment';
import type { NikolausSlotDefinition } from './nikolaus-config';
import {
  NIKOLAUS_CONFIG,
  dateToLocalParts,
  getChangeDeadline,
  getNikolausSlots,
  isBookingClosed,
  localDateTimeToDate,
  slotKeyToDate,
} from './nikolaus-config';
import type { NikolausBookingDetails } from './nikolaus-validation';
import type { GeocodeResult } from './geocoding';
import { parseTags } from './nikolaus-einteilung';
import { geocodeAddress } from './geocoding';

export type NikolausBookingStatus = 'Ausstehend' | 'Bestaetigt' | 'Storniert' | 'Abgelaufen';

/** Location of the address as stored in the list (text columns). */
export interface NikolausGeoFields {
  Breitengrad: string;
  Laengengrad: string;
  GeoGenauigkeit: string;
}

export interface NikolausBooking extends NikolausBookingDetails {
  id: string;
  /** Version of the item as loaded, for conditional updates. */
  etag: string;
  slotKey: string;
  status: NikolausBookingStatus;
  geo: NikolausGeoFields;
  /** Tags for the internal planning; never shown to the family. */
  internalTags: string[];
  /** Stufen whose suggestion from the Stufen-Abgleich was rejected. */
  rejectedStufen: string[];
  tokenHash: string;
  reservedUntil: Date | undefined;
  confirmedAt: Date | undefined;
  changedAt: Date | undefined;
  linkSentAt: Date | undefined;
  /** Internal provenance; never included in public or staff DTOs. */
  move?: BookingMoveMarker;
}

export interface BookingMoveMarker {
  kind: 'source' | 'copy';
  operationId: string;
  tokenHash: string;
}

/** The journal contains identifiers and a digest, never family data or tokens. */
export interface BookingMoveJournal {
  schema: 1;
  operationId: string;
  sourceId: string;
  sourceVersion: string;
  sourceFingerprint: string;
  sourceSlotKey: string;
  targetSlotKey: string;
  claimedSourceVersion?: string;
  copyId?: string;
  phase: 'preparing' | 'selected' | 'committed' | 'aborted';
}

export function parseBookingMoveMarker(value: string): BookingMoveMarker | undefined {
  const match = /^move-(source|copy):([a-f0-9-]{36}):([a-f0-9]{64})$/.exec(value);
  return match
    ? { kind: match[1] as BookingMoveMarker['kind'], operationId: match[2], tokenHash: match[3] }
    : undefined;
}

function moveMarker(
  kind: BookingMoveMarker['kind'],
  operationId: string,
  tokenHash: string
): string {
  return `move-${kind}:${operationId}:${tokenHash}`;
}

function parseMoveJournal(value: unknown): BookingMoveJournal | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid booking move journal');
  const row = value as Record<string, unknown>;
  if (
    row.schema !== 1 ||
    typeof row.operationId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(row.operationId) ||
    typeof row.sourceId !== 'string' ||
    !/^\d+$/.test(row.sourceId) ||
    typeof row.sourceVersion !== 'string' ||
    !row.sourceVersion ||
    row.sourceVersion === '*' ||
    typeof row.sourceFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.sourceFingerprint) ||
    typeof row.sourceSlotKey !== 'string' ||
    typeof row.targetSlotKey !== 'string' ||
    !['preparing', 'selected', 'committed', 'aborted'].includes(String(row.phase)) ||
    (row.copyId !== undefined && (typeof row.copyId !== 'string' || !/^\d+$/.test(row.copyId))) ||
    (row.claimedSourceVersion !== undefined &&
      (typeof row.claimedSourceVersion !== 'string' ||
        !row.claimedSourceVersion ||
        row.claimedSourceVersion === '*')) ||
    ((row.phase === 'selected' || row.phase === 'committed') &&
      (!row.copyId || !row.claimedSourceVersion))
  ) {
    throw new Error('Invalid booking move journal');
  }
  return row as unknown as BookingMoveJournal;
}

function moveKey(sourceId: string): string {
  return `booking-move:${sourceId}`;
}

function fingerprint(booking: NikolausBooking): string {
  const sorted = Object.fromEntries(
    Object.entries(booking)
      .filter(([key]) => key !== 'etag' && key !== 'move')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

async function readMove(sourceId: string): Promise<BookingMoveJournal | undefined> {
  const journal = parseMoveJournal((await readNikolausState(moveKey(sourceId)))?.data);
  if (journal && journal.sourceId !== sourceId) throw new Error('Invalid booking move journal');
  return journal;
}

async function changeMove(
  journal: BookingMoveJournal,
  patch: Partial<BookingMoveJournal>
): Promise<BookingMoveJournal | undefined> {
  return mutateNikolausState<BookingMoveJournal | undefined>(
    moveKey(journal.sourceId),
    parseMoveJournal,
    (current) =>
      current?.operationId === journal.operationId &&
      current.claimedSourceVersion === journal.claimedSourceVersion &&
      current.copyId === journal.copyId &&
      !(current.phase === 'aborted' && patch.phase !== 'aborted') &&
      !(current.phase === 'committed' && patch.phase !== 'committed')
        ? { ...current, ...patch }
        : undefined
  );
}

async function moveJournals(bookings: NikolausBooking[]): Promise<Map<string, BookingMoveJournal>> {
  if (!bookings.some((b) => b.move?.kind === 'copy')) return new Map();
  const records = await listNikolausStates('booking-move:');
  const journals = records.map((record) => {
    const row = parseMoveJournal(record.data);
    if (!row || record.key !== moveKey(row.sourceId))
      throw new Error('Invalid booking move journal');
    return row;
  });
  if (new Set(journals.map((row) => row.operationId)).size !== journals.length)
    throw new Error('Invalid booking move journal');
  return new Map(journals.map((row) => [row.operationId, row]));
}

function eligibleCopy(
  booking: NikolausBooking,
  all: NikolausBooking[],
  journals: Map<string, BookingMoveJournal>,
  visible: boolean
): boolean {
  if (booking.move?.kind !== 'copy') return true;
  const journal = journals.get(booking.move.operationId);
  if (!journal || journal.phase === 'aborted' || (journal.copyId && journal.copyId !== booking.id))
    return false;
  const source = all.find((b) => b.id === journal.sourceId);
  if (!source)
    return journal.copyId === booking.id && ['selected', 'committed'].includes(journal.phase);
  if (visible) return false;
  return (
    source.move?.operationId === journal.operationId &&
    fingerprint(source) === journal.sourceFingerprint
  );
}

export interface NikolausSlotAvailability {
  key: string;
  date: string;
  time: string;
  endTime: string;
  capacity: number;
  available: number;
  /** The online booking for this day is closed (from midnight of the day on). */
  closed: boolean;
}

/**
 * Pending bookings keep blocking their slot for this long after `ReserviertBis`, so a
 * confirmation arriving right at the expiry can never race with a new booking.
 */
const EXPIRY_GRACE_MS = 5 * 60_000;

/** Minimum time between two mails with a new management link for the same booking. */
export const LINK_RESEND_COOLDOWN_MINUTES = 15;

interface NikolausListItem {
  id: string;
  eTag?: string;
  fields: {
    Title?: string;
    Email?: string;
    Telefon?: string;
    Strasse?: string;
    PLZ?: string;
    Ort?: string;
    AdressHinweise?: string;
    AnzahlKinder?: number;
    MitKrampus?: boolean;
    Versteck?: string;
    Bemerkungen?: string;
    Breitengrad?: string;
    Laengengrad?: string;
    GeoGenauigkeit?: string;
    InterneTags?: string;
    AbgelehnteStufen?: string;
    SlotKey?: string;
    Status?: string;
    TokenHash?: string;
    ReserviertBisDatum?: string;
    ReserviertBisUhrzeit?: string;
    BestaetigtAmDatum?: string;
    BestaetigtAmUhrzeit?: string;
    GeaendertAmDatum?: string;
    GeaendertAmUhrzeit?: string;
    LinkGesendetAmDatum?: string;
    LinkGesendetAmUhrzeit?: string;
  };
}

function getListId(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_LIST_ID);
}

/** Dates are stored as two text columns `<prefix>Datum` / `<prefix>Uhrzeit` in local time. */
export type DatePrefix =
  'Termin' | 'ReserviertBis' | 'BestaetigtAm' | 'GeaendertAm' | 'LinkGesendetAm';

function parseLocalDateTime(date: string | undefined, time: string | undefined): Date | undefined {
  if (!date || !time || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return undefined;
  }
  const parsed = localDateTimeToDate(date, time);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** The two text columns for a point in time, precise to the minute. */
export function dateFields(prefix: DatePrefix, date: Date | undefined): Record<string, string> {
  if (!date) return {};
  const { date: day, time } = dateToLocalParts(date);
  return { [`${prefix}Datum`]: day, [`${prefix}Uhrzeit`]: time };
}

/** Rounds up to the next full minute, so a stored reservation is never shorter than promised. */
function ceilToMinute(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / 60_000) * 60_000);
}

export function detailFields(details: NikolausBookingDetails): Record<string, unknown> {
  return {
    Title: details.familyName,
    Email: details.email,
    Telefon: details.phone,
    Strasse: details.street,
    PLZ: details.postalCode,
    Ort: details.city,
    AdressHinweise: details.addressNotes,
    AnzahlKinder: details.childrenCount,
    MitKrampus: details.withKrampus,
    Versteck: details.hidingPlace,
    Bemerkungen: details.notes,
  };
}

const GEO_PRECISION_LABELS = { address: 'Adresse', street: 'Straße', area: 'Ort' };

function geoFields(result: GeocodeResult): NikolausGeoFields {
  if (result.found && result.precision && result.lat !== undefined && result.lon !== undefined) {
    return {
      Breitengrad: result.lat.toFixed(6),
      Laengengrad: result.lon.toFixed(6),
      GeoGenauigkeit: GEO_PRECISION_LABELS[result.precision],
    };
  }
  return {
    Breitengrad: '',
    Laengengrad: '',
    GeoGenauigkeit: result.unavailable ? 'nicht ermittelt' : 'nicht gefunden',
  };
}

async function locate(details: NikolausBookingDetails): Promise<NikolausGeoFields> {
  return geoFields(await geocodeAddress(details.street, details.postalCode, details.city));
}

function mapBooking(item: unknown): NikolausBooking {
  const listItem = item as NikolausListItem;
  const fields = listItem.fields ?? {};
  const move = parseBookingMoveMarker(fields.TokenHash ?? '');
  return {
    id: String(listItem.id),
    etag: listItem.eTag ?? '',
    familyName: fields.Title ?? '',
    email: fields.Email ?? '',
    phone: fields.Telefon ?? '',
    street: fields.Strasse ?? '',
    postalCode: fields.PLZ ?? '',
    city: fields.Ort ?? '',
    addressNotes: fields.AdressHinweise ?? '',
    childrenCount: Number(fields.AnzahlKinder ?? 0),
    withKrampus: fields.MitKrampus === true,
    hidingPlace: fields.Versteck ?? '',
    notes: fields.Bemerkungen ?? '',
    geo: {
      Breitengrad: fields.Breitengrad ?? '',
      Laengengrad: fields.Laengengrad ?? '',
      GeoGenauigkeit: fields.GeoGenauigkeit ?? '',
    },
    internalTags: parseTags(fields.InterneTags ?? ''),
    rejectedStufen: parseTags(fields.AbgelehnteStufen ?? ''),
    slotKey: fields.SlotKey ?? '',
    status: (fields.Status as NikolausBookingStatus) ?? 'Ausstehend',
    tokenHash: move?.tokenHash ?? fields.TokenHash ?? '',
    ...(move ? { move } : {}),
    reservedUntil: parseLocalDateTime(fields.ReserviertBisDatum, fields.ReserviertBisUhrzeit),
    confirmedAt: parseLocalDateTime(fields.BestaetigtAmDatum, fields.BestaetigtAmUhrzeit),
    changedAt: parseLocalDateTime(fields.GeaendertAmDatum, fields.GeaendertAmUhrzeit),
    linkSentAt: parseLocalDateTime(fields.LinkGesendetAmDatum, fields.LinkGesendetAmUhrzeit),
  };
}

/** Whether a booking currently occupies its slot. */
export function isBlocking(booking: NikolausBooking, now: Date = new Date()): boolean {
  if (booking.status === 'Bestaetigt') return true;
  if (booking.status !== 'Ausstehend' || !booking.reservedUntil) return false;
  return booking.reservedUntil.getTime() + EXPIRY_GRACE_MS > now.getTime();
}

/** Loads physical records, including provisional copies needed by capacity and retention. */
export async function getAllBookingRecords(): Promise<NikolausBooking[]> {
  const items = await getSharePointListItems(getListId(), { expand: 'fields' });
  return items.map(mapBooking);
}

/** Provisional copies cannot be changed through public or staff views. */
export async function getAllBookings(): Promise<NikolausBooking[]> {
  const all = await getAllBookingRecords();
  const journals = await moveJournals(all);
  return all.filter((booking) => eligibleCopy(booking, all, journals, true));
}

/** Loads all bookings that currently occupy one of the configured slots. */
async function getBlockingBookings(now: Date, includeClaims = false): Promise<NikolausBooking[]> {
  const slotKeys = new Set(getNikolausSlots().map((slot) => slot.key));
  const bookings = await getAllBookingRecords();
  const journals = await moveJournals(bookings);
  return bookings.filter(
    (booking) =>
      slotKeys.has(booking.slotKey) &&
      isBlocking(booking, now) &&
      eligibleCopy(booking, bookings, journals, !includeClaims)
  );
}

/** Capacity includes eligible provisional copies without exposing them in booking views. */
export async function getCapacityBlockingBookings(
  now: Date = new Date()
): Promise<NikolausBooking[]> {
  return getBlockingBookings(now, true);
}

/** Returns all configured slots together with their remaining capacity. */
export async function getSlotAvailability(
  now: Date = new Date()
): Promise<NikolausSlotAvailability[]> {
  const bookings = await getBlockingBookings(now, true);
  const taken = new Map<string, number>();
  for (const booking of bookings) {
    taken.set(booking.slotKey, (taken.get(booking.slotKey) ?? 0) + 1);
  }

  return getNikolausSlots().map((slot) => {
    const closed = isBookingClosed(slot.date, now);
    return {
      key: slot.key,
      date: slot.date,
      time: slot.time,
      endTime: slot.endTime,
      capacity: slot.capacity,
      available:
        closed || isSlotInPast(slot, now)
          ? 0
          : Math.max(0, slot.capacity - (taken.get(slot.key) ?? 0)),
      closed,
    };
  });
}

export function isSlotInPast(slot: NikolausSlotDefinition, now: Date = new Date()): boolean {
  return slotKeyToDate(slot.key).getTime() <= now.getTime();
}

/** Whether the booking may still be changed or cancelled online. */
export function isBeforeChangeDeadline(booking: NikolausBooking, now: Date = new Date()): boolean {
  return getChangeDeadline(booking.slotKey).getTime() > now.getTime();
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of a plain token against the stored hash. */
export function verifyToken(booking: NikolausBooking, token: string): boolean {
  if (!booking.tokenHash || !token) return false;
  const expected = Buffer.from(booking.tokenHash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hasSameEmail(booking: NikolausBooking, email: string): boolean {
  return normalizeEmail(booking.email) === normalizeEmail(email);
}

/**
 * Finds an active booking (confirmed or reserved) for an e-mail address.
 * @param excludeTokenHash Ignores the booking with this token, e.g. the one being edited.
 */
export async function findActiveBookingByEmail(
  email: string,
  excludeTokenHash?: string,
  now: Date = new Date()
): Promise<NikolausBooking | undefined> {
  const matches = (await getBlockingBookings(now)).filter(
    (b) => hasSameEmail(b, email) && b.tokenHash !== excludeTokenHash
  );
  return matches.sort((a, b) => Number(b.id) - Number(a.id))[0];
}

/**
 * Finds the visible booking belonging to a management token. During a move only
 * the source is visible; its journal-selected replacement becomes visible after commit.
 * @param loadBookings Source of the bookings, e.g. a short-lived cache for polling endpoints.
 */
export async function findBookingByToken(
  token: string,
  loadBookings: () => Promise<NikolausBooking[]> = getAllBookings
): Promise<NikolausBooking | undefined> {
  const matches = (await loadBookings()).filter((booking) => verifyToken(booking, token));
  return matches.sort((a, b) => Number(b.id) - Number(a.id))[0];
}

type ClaimResult =
  { ok: true; id: string; etag: string; blocking: NikolausBooking[] } | { ok: false };

/**
 * Writes a new item into a slot without ever exceeding the slot capacity.
 *
 * SharePoint offers no transactions, so the item is written first and verified
 * afterwards: all bookings blocking the same slot are re-read, and if `capacity` of
 * them have a lower (= earlier) item ID, the new item is removed again. Of two
 * concurrent requests the later one (higher ID) always sees the earlier one, so at
 * most `capacity` bookings can survive.
 */
async function claimSlot(
  fields: Record<string, unknown>,
  slot: NikolausSlotDefinition,
  now: Date
): Promise<ClaimResult> {
  const listId = getListId();

  // Fast path: reject without writing if the slot is already full.
  const before = await getBlockingBookings(now, true);
  if (before.filter((b) => b.slotKey === slot.key).length >= slot.capacity) {
    return { ok: false };
  }

  const { id, etag } = await createSharePointListItemWithVersion(listId, {
    ...fields,
    SlotKey: slot.key,
    ...dateFields('Termin', slotKeyToDate(slot.key)),
  });

  let after: NikolausBooking[];
  let earlier: number;
  try {
    after = await getBlockingBookings(new Date(), true);
    earlier = after.filter((b) => b.slotKey === slot.key && Number(b.id) < Number(id)).length;
  } catch (error: unknown) {
    // Without verification the item must not stay in the list
    await deleteSharePointListItem(listId, id, etag);
    throw error;
  }

  if (earlier >= slot.capacity) {
    await deleteSharePointListItem(listId, id, etag);
    return { ok: false };
  }

  return { ok: true, id, etag, blocking: after };
}

export type CreateBookingResult =
  | { ok: true; id: string; etag: string; token: string; reservedUntil: Date }
  | { ok: false; reason: 'SLOT_FULL' | 'EMAIL_EXISTS' };

/**
 * Reserves a slot for a new, unconfirmed booking. Each e-mail address may only have
 * one active booking; of concurrent bookings with the same address the earliest wins.
 */
export async function createBooking(
  details: NikolausBookingDetails,
  slot: NikolausSlotDefinition,
  now: Date = new Date()
): Promise<CreateBookingResult> {
  if (await findActiveBookingByEmail(details.email, undefined, now)) {
    return { ok: false, reason: 'EMAIL_EXISTS' };
  }

  // Geocode before claiming the slot, so the time between writing and verifying stays short
  const geo = await locate(details);

  const token = randomBytes(32).toString('base64url');
  const reservedUntil = ceilToMinute(
    new Date(now.getTime() + NIKOLAUS_CONFIG.pendingHoldMinutes * 60_000)
  );

  const result = await claimSlot(
    {
      ...detailFields(details),
      ...geo,
      Status: 'Ausstehend',
      TokenHash: hashToken(token),
      ...dateFields('ReserviertBis', reservedUntil),
      ...dateFields('LinkGesendetAm', now),
    },
    slot,
    now
  );
  if (!result.ok) {
    return { ok: false, reason: 'SLOT_FULL' };
  }

  const earlierWithSameEmail = result.blocking.some(
    (b) => hasSameEmail(b, details.email) && Number(b.id) < Number(result.id)
  );
  if (earlierWithSameEmail) {
    await deleteSharePointListItem(getListId(), result.id, result.etag);
    return { ok: false, reason: 'EMAIL_EXISTS' };
  }

  return { ok: true, id: result.id, etag: result.etag, token, reservedUntil };
}

export type RescheduleResult =
  | { ok: true; booking: NikolausBooking }
  | { ok: false; reason: 'SLOT_FULL' | 'ALREADY_CHANGED' | 'NOT_MOVED' };

async function storedBooking(id: string): Promise<NikolausBooking | undefined> {
  const item = await getSharePointListItem(getListId(), id);
  return item ? mapBooking(item) : undefined;
}

async function removeMoveCopies(operationId: string): Promise<void> {
  for (const copy of await getAllBookingRecords()) {
    if (copy.move?.kind !== 'copy' || copy.move.operationId !== operationId) continue;
    try {
      await deleteSharePointListItem(getListId(), copy.id, requireBookingVersion(copy.etag));
    } catch (error: unknown) {
      if (getGraphStatus(error) !== 412 && getGraphStatus(error) !== 404) throw error;
    }
  }
}

/** Fence every paused delete before releasing a failed operation's provisional copies. */
async function abandonMove(journal: BookingMoveJournal): Promise<boolean> {
  const latest = await readMove(journal.sourceId);
  if (
    latest?.operationId !== journal.operationId ||
    latest.claimedSourceVersion !== journal.claimedSourceVersion ||
    latest.copyId !== journal.copyId ||
    latest.phase === 'committed'
  )
    return true;
  let source = await storedBooking(journal.sourceId);
  if (!source) return false;
  if (source.move?.operationId === journal.operationId) {
    const fence = randomUUID();
    try {
      await updateSharePointListItem(
        getListId(),
        source.id,
        {
          TokenHash: moveMarker('source', fence, source.tokenHash),
        },
        requireBookingVersion(source.etag)
      );
    } catch (error: unknown) {
      source = await storedBooking(journal.sourceId);
      if (!source) return false;
      if (getGraphStatus(error) === 412 && source.move?.operationId === journal.operationId) {
        throw Object.assign(new Error('Die Buchung wurde inzwischen geändert. Bitte neu laden.'), {
          statusCode: 412,
        });
      }
      if (getGraphStatus(error) !== 412 && source.move?.operationId !== fence) throw error;
    }
  }
  if (!(await changeMove(journal, { phase: 'aborted' }))) return true;
  await removeMoveCopies(journal.operationId);
  return true;
}

/** Removes committed provenance without overwriting newer booking fields. */
async function clearCommittedCopyMarker(
  booking: NikolausBooking
): Promise<NikolausBooking | undefined> {
  if (booking.move?.kind !== 'copy') return booking;
  try {
    await updateSharePointListItem(
      getListId(),
      booking.id,
      { TokenHash: booking.tokenHash },
      requireBookingVersion(booking.etag)
    );
  } catch (error: unknown) {
    if (getGraphStatus(error) !== 412) throw error;
  }
  // Reload the version after cleanup, including a concurrent update that won the CAS.
  return getBooking(booking.id);
}

/**
 * Claims a replacement with a new item ID so it cannot outrank existing slot occupants.
 * A source CAS fence and durable journal select the replacement before deleting the source.
 * Abandoned copies stay hidden and release capacity even when their cleanup fails.
 */
export async function rescheduleBooking(
  booking: NikolausBooking,
  slot: NikolausSlotDefinition,
  now: Date = new Date()
): Promise<RescheduleResult> {
  const listId = getListId();
  const currentSource = await storedBooking(booking.id);
  requireBookingVersion(booking.etag);
  if (!currentSource) {
    const committed = await readMove(booking.id);
    if (
      committed?.copyId &&
      committed.phase !== 'aborted' &&
      committed.sourceVersion === booking.etag &&
      committed.sourceFingerprint === fingerprint(booking) &&
      committed.targetSlotKey === slot.key
    ) {
      const moved = await getBooking(committed.copyId);
      if (moved && (await changeMove(committed, { phase: 'committed' }))) {
        const cleaned = await clearCommittedCopyMarker(moved);
        if (cleaned) return { ok: true, booking: cleaned };
      }
    }
    return { ok: false, reason: 'ALREADY_CHANGED' };
  }
  if (currentSource.etag !== booking.etag) {
    return { ok: false, reason: 'ALREADY_CHANGED' };
  }
  const sourceFingerprint = fingerprint(booking);
  const previous = await readMove(booking.id);
  const resume =
    previous &&
    previous.phase !== 'aborted' &&
    currentSource.move?.kind === 'source' &&
    currentSource.move.operationId === previous.operationId &&
    previous.claimedSourceVersion === currentSource.etag &&
    previous.sourceFingerprint === sourceFingerprint &&
    previous.targetSlotKey === slot.key;
  const desired: BookingMoveJournal = resume
    ? previous
    : {
        schema: 1,
        operationId: randomUUID(),
        sourceId: booking.id,
        sourceVersion: booking.etag,
        sourceFingerprint,
        sourceSlotKey: booking.slotKey,
        targetSlotKey: slot.key,
        phase: 'preparing',
      };
  // Fence the physical source before replacing its journal. A delayed stale writer must
  // never overwrite the winner's journal after that winner already deleted the source.
  if (!resume) {
    try {
      await updateSharePointListItem(
        listId,
        booking.id,
        {
          TokenHash: moveMarker('source', desired.operationId, booking.tokenHash),
        },
        requireBookingVersion(booking.etag)
      );
    } catch (error: unknown) {
      const adopted = await storedBooking(booking.id);
      if (
        adopted?.move?.operationId !== desired.operationId ||
        fingerprint(adopted) !== sourceFingerprint
      ) {
        if (getGraphStatus(error) === 412 || getGraphStatus(error) === 404) {
          return { ok: false, reason: 'ALREADY_CHANGED' };
        }
        throw error;
      }
    }
  }
  const claimed = await storedBooking(booking.id);
  if (
    !claimed ||
    claimed.move?.operationId !== desired.operationId ||
    fingerprint(claimed) !== sourceFingerprint
  ) {
    return { ok: false, reason: 'ALREADY_CHANGED' };
  }
  let journal = await mutateNikolausState<BookingMoveJournal | undefined>(
    moveKey(booking.id),
    parseMoveJournal,
    (latest) => {
      if (latest?.operationId === desired.operationId) return latest;
      return latest?.operationId === previous?.operationId
        ? { ...desired, claimedSourceVersion: claimed.etag }
        : undefined;
    }
  );
  if (!journal) return { ok: false, reason: 'ALREADY_CHANGED' };
  if (previous && previous.operationId !== journal.operationId) {
    await removeMoveCopies(previous.operationId);
  }

  const operationId = journal.operationId;
  const existing = (await getAllBookingRecords())
    .filter(
      (copy) =>
        copy.move?.kind === 'copy' &&
        copy.move.operationId === operationId &&
        (!journal!.copyId || copy.id === journal!.copyId)
    )
    .sort((a, b) => Number(a.id) - Number(b.id))[0];
  let result: ClaimResult;
  if (existing) {
    const blocking = await getBlockingBookings(now, true);
    if (
      existing.slotKey !== slot.key ||
      blocking.filter((b) => b.slotKey === slot.key && Number(b.id) < Number(existing.id)).length >=
        slot.capacity
    ) {
      await abandonMove(journal);
      return { ok: false, reason: 'SLOT_FULL' };
    }
    result = { ok: true, id: existing.id, etag: existing.etag, blocking };
  } else {
    if (journal.copyId) {
      await abandonMove(journal);
      return { ok: false, reason: 'NOT_MOVED' };
    }
    result = await claimSlot(
      {
        ...detailFields(booking),
        ...booking.geo,
        InterneTags: booking.internalTags.join(', '),
        AbgelehnteStufen: booking.rejectedStufen.join(', '),
        Status: booking.status,
        TokenHash: moveMarker('copy', operationId, booking.tokenHash),
        ...dateFields('ReserviertBis', booking.reservedUntil),
        ...dateFields('BestaetigtAm', booking.confirmedAt),
        ...dateFields('LinkGesendetAm', booking.linkSentAt),
        ...dateFields('GeaendertAm', now),
      },
      slot,
      now
    );
  }
  if (!result.ok) {
    await abandonMove(journal);
    return { ok: false, reason: 'SLOT_FULL' };
  }
  const copyId = result.id;
  const selected = await mutateNikolausState<BookingMoveJournal | undefined>(
    moveKey(booking.id),
    parseMoveJournal,
    (latest) =>
      latest?.operationId === operationId &&
      latest.phase !== 'aborted' &&
      (!latest.copyId || latest.copyId === copyId)
        ? { ...latest, copyId, phase: latest.phase === 'committed' ? 'committed' : 'selected' }
        : undefined
  );
  if (!selected) {
    await deleteSharePointListItem(listId, result.id, result.etag);
    return { ok: false, reason: 'ALREADY_CHANGED' };
  }
  journal = selected;
  let removed = false;
  for (let attempt = 0; attempt < 2 && !removed; attempt++) {
    try {
      await deleteSharePointListItem(
        listId,
        booking.id,
        requireBookingVersion(journal.claimedSourceVersion!)
      );
      removed = true;
    } catch (error: unknown) {
      if (!(await storedBooking(booking.id))) {
        const surviving = await storedBooking(result.id);
        const latest = await readMove(booking.id);
        if (
          latest?.operationId === operationId &&
          latest.copyId === result.id &&
          surviving?.etag === result.etag
        ) {
          removed = true;
          break;
        }
        throw Object.assign(new Error('Die Buchung wurde inzwischen geändert. Bitte neu laden.'), {
          statusCode: 412,
        });
      }
      if (getGraphStatus(error) === 412) {
        if (await abandonMove(journal)) return { ok: false, reason: 'ALREADY_CHANGED' };
        removed = true;
      }
    }
  }
  if (!removed && (await abandonMove(journal))) return { ok: false, reason: 'NOT_MOVED' };
  if (!(await changeMove(journal, { phase: 'committed' }))) {
    throw Object.assign(new Error('Die Buchung wurde inzwischen geändert. Bitte neu laden.'), {
      statusCode: 412,
    });
  }
  const moved = await getBooking(result.id);
  if (!moved) return { ok: false, reason: 'ALREADY_CHANGED' };
  const cleaned = await clearCommittedCopyMarker(moved);
  return cleaned ? { ok: true, booking: cleaned } : { ok: false, reason: 'ALREADY_CHANGED' };
}

/** Replaces the internal tags of a booking. */
export async function setBookingTags(id: string, tags: string[], etag: string): Promise<void> {
  await updateSharePointListItem(
    getListId(),
    id,
    { InterneTags: tags.join(', ') },
    requireBookingVersion(etag)
  );
}

/** Replaces the Stufen whose suggestion from the Stufen-Abgleich was rejected. */
export async function setBookingRejectedStufen(
  id: string,
  stufen: string[],
  etag: string
): Promise<void> {
  await updateSharePointListItem(
    getListId(),
    id,
    { AbgelehnteStufen: stufen.join(', ') },
    requireBookingVersion(etag)
  );
}

/** Updates the details of a booking; the address is located again if it changed. */
export async function updateBookingDetails(
  booking: NikolausBooking,
  details: NikolausBookingDetails,
  now: Date = new Date()
): Promise<NikolausBooking> {
  const addressChanged =
    details.street !== booking.street ||
    details.postalCode !== booking.postalCode ||
    details.city !== booking.city;
  const geo = addressChanged ? await locate(details) : booking.geo;

  await updateSharePointListItem(
    getListId(),
    booking.id,
    {
      ...detailFields(details),
      ...geo,
      ...dateFields('GeaendertAm', now),
    },
    requireBookingVersion(booking.etag)
  );
  return (await getBooking(booking.id)) ?? { ...booking, ...details, geo, changedAt: now };
}

/** Cancels a booking on behalf of the team and records when it was changed. */
export async function cancelBooking(
  booking: NikolausBooking,
  now: Date = new Date()
): Promise<void> {
  await setBookingStatus(booking, 'Storniert', dateFields('GeaendertAm', now));
}

/** Confirms only the reservation version that was loaded by the caller. */
export async function confirmBooking(
  booking: NikolausBooking,
  now: Date = new Date()
): Promise<NikolausBooking> {
  await setBookingStatus(booking, 'Bestaetigt', dateFields('BestaetigtAm', now));
  return (await getBooking(booking.id)) ?? { ...booking, status: 'Bestaetigt', confirmedAt: now };
}

/** Whether a new management link may be sent for this booking yet. */
export function canResendLink(booking: NikolausBooking, now: Date = new Date()): boolean {
  return (
    !booking.linkSentAt ||
    now.getTime() - booking.linkSentAt.getTime() >= LINK_RESEND_COOLDOWN_MINUTES * 60_000
  );
}

/**
 * Replaces the management token of a booking, invalidating all previous links.
 * @returns The new plain token for the link in the mail.
 */
export async function rotateToken(
  booking: NikolausBooking,
  now: Date = new Date()
): Promise<string | undefined> {
  if (!canResendLink(booking, now)) return undefined;
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const etag = requireBookingVersion(booking.etag);
  try {
    await updateSharePointListItem(
      getListId(),
      booking.id,
      {
        TokenHash: tokenHash,
        ...dateFields('LinkGesendetAm', ceilToMinute(now)),
      },
      etag
    );
  } catch (error: unknown) {
    if (getGraphStatus(error) === 412 || getGraphStatus(error) === 404) throw error;
    // A lost response is safe to adopt only if the row contains this attempt's
    // unguessable token. The reserved link can then still be delivered.
    const current = await getBooking(booking.id);
    if (current?.tokenHash !== tokenHash) throw error;
  }
  return token;
}

/**
 * Undoes `rotateToken` when the mail with the new link could not be sent: the previous
 * link works again and the cooldown is lifted. Skipped if a concurrent request has
 * rotated the token again in the meantime.
 */
export async function restorePreviousToken(
  booking: NikolausBooking,
  failedToken: string
): Promise<void> {
  const current = await getBooking(booking.id);
  if (!current || current.tokenHash !== hashToken(failedToken)) return;
  const allowedAgain = new Date(Date.now() - LINK_RESEND_COOLDOWN_MINUTES * 60_000);
  try {
    await updateSharePointListItem(
      getListId(),
      booking.id,
      {
        TokenHash: booking.tokenHash,
        ...dateFields('LinkGesendetAm', booking.linkSentAt ?? allowedAgain),
      },
      requireBookingVersion(current.etag)
    );
  } catch (error: unknown) {
    if (getGraphStatus(error) !== 412 && getGraphStatus(error) !== 404) throw error;
  }
}

export async function getBooking(id: string): Promise<NikolausBooking | undefined> {
  const booking = await storedBooking(id);
  if (!booking || booking.move?.kind !== 'copy') return booking;
  const records = await getAllBookingRecords();
  return eligibleCopy(booking, records, await moveJournals(records), true) ? booking : undefined;
}

export async function deleteBooking(id: string, etag: string): Promise<void> {
  await deleteSharePointListItem(getListId(), id, requireBookingVersion(etag));
}

export async function setBookingStatus(
  booking: NikolausBooking,
  status: NikolausBookingStatus,
  extraFields: Record<string, unknown> = {}
): Promise<void> {
  await updateSharePointListItem(
    getListId(),
    booking.id,
    { Status: status, ...extraFields },
    requireBookingVersion(booking.etag)
  );
}

/** Never turn a missing or wildcard version into an unconditional write. */
export function requireBookingVersion(etag: string): string {
  if (!etag || etag === '*') {
    const error = new Error(
      'Die Buchung wurde inzwischen geändert. Bitte laden Sie die Seite neu.'
    );
    throw Object.assign(error, { statusCode: 412 });
  }
  return etag;
}
