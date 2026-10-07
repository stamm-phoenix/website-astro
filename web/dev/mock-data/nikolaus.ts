/**
 * Nikolausdienst of the mock API: bookings around Feldkirchen-Westerham, a saved Dispo per
 * day (calculated with the real Dispo algorithm), helpers and their Einteilung.
 */
import { createHash } from 'node:crypto';
import type {
  NikolausBookingInfo,
  NikolausSlot,
  NikolausVisitProgress,
  StaffNikolausBooking,
  StaffNikolausDispoData,
  StaffNikolausDispoRow,
  StaffNikolausEinteilungData,
  StaffNikolausEinteilungRow,
  StaffNikolausFahrtData,
  StaffNikolausFahrtStop,
  StaffNikolausHelfendeData,
  StaffNikolausHelper,
  StaffNikolausOverview,
  StaffNikolausStufenSuggestion,
  StaffNikolausTeamMember,
  NikolausAuditEntry,
  StaffNikolausSteuerung,
} from '../../src/lib/types';
import type { NikolausCoordinates, NikolausSettings } from '../../src/lib/nikolausConfig';
import { distanceKm, getNikolausSlots, getNikolausTeams } from '../../src/lib/nikolausConfig';
import {
  evaluateDispo,
  minutesToTime,
  solveDispo,
  timeToMinutes,
  visitMinutes,
} from '../../src/lib/nikolausDispo';
import type { EinteilungDay, HelperRole } from '../../src/lib/nikolausEinteilung';
import { HELPER_ROLES, KITCHEN, solveEinteilung } from '../../src/lib/nikolausEinteilung';
import { localDateTimeToDate } from '../../../api/lib/nikolaus-config';
import { MOCK_NOW, fingerprint, isoFromNow, newEtag, newId } from './util';

export interface MockNikolausBooking extends StaffNikolausBooking {
  etag: string;
}

/** Settings of the Steuerung; changed by the mock endpoints of the Steuerung. */
export const MOCK_NIKOLAUS_SETTINGS: NikolausSettings = {
  publicActive: false,
  staffActive: true,
  maintenance: false,
  pendingHoldMinutes: 120,
  changeDeadlineHours: 24,
  days: [
    { date: '2026-12-05', start: '17:00', end: '21:00', teams: 2 },
    { date: '2026-12-06', start: '17:00', end: '21:00', teams: 3 },
  ],
  area: {
    base: { name: 'Pfarrheim', lat: 47.90885, lon: 11.84664 },
    servicePostalCodes: ['83620', '83052'],
    farDistanceKm: 8,
  },
};
const CONFIG = MOCK_NIKOLAUS_SETTINGS;

export const DAYS = CONFIG.days.map((d) => d.date).sort();
const [DAY1, DAY2] = DAYS;
const BASE = CONFIG.area.base;

type Status = StaffNikolausBooking['status'];

interface BookingSeed {
  family: string;
  street: string;
  postalCode: string;
  city: string;
  /** `null`: address could not be located. */
  at: [number, number] | null;
  children: number;
  krampus: boolean;
  /** Day index (0/1) and time. */
  slot: [0 | 1, string];
  status?: Status;
  tags?: string[];
  addressNotes?: string;
  hidingPlace?: string;
  notes?: string;
  approximate?: boolean;
}

const SEEDS: BookingSeed[] = [
  {
    family: 'Huber',
    street: 'Ahornweg 7',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9102, 11.8431],
    children: 2,
    krampus: false,
    slot: [0, '17:00'],
    tags: ['Wölflinge'],
    hidingPlace: 'Hinter der Gartenhütte links neben der Haustür',
    notes: 'Lena (6) und Paul (4). Paul hat etwas Angst, bitte sanft.',
  },
  {
    family: 'Bauer',
    street: 'Birkenstraße 14',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9071, 11.8502],
    children: 3,
    krampus: true,
    slot: [0, '17:00'],
    hidingPlace: 'Im Holzschuppen vor dem Haus',
    addressNotes: 'Klingel „Bauer/Wimmer“, Eingang auf der Rückseite',
  },
  {
    family: 'Wagner',
    street: 'Schulstraße 22',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9119, 11.8489],
    children: 1,
    krampus: false,
    slot: [0, '17:30'],
    hidingPlace: 'Garage, Tor ist offen',
  },
  {
    family: 'Mayr',
    street: 'Westerhamer Straße 3',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.8952, 11.8458],
    children: 4,
    krampus: true,
    slot: [0, '17:30'],
    tags: ['Jungpfadfinder', 'Hund'],
    hidingPlace: 'Kiste auf der Terrasse',
    notes:
      'Vier Kinder zwischen 3 und 11 Jahren. Die Große (11) glaubt nicht mehr an den Nikolaus, spielt aber für die Kleinen mit. Wir haben einen großen, freundlichen Hund (Bruno) – er ist während des Besuchs im Garten. Bitte im Goldenen Buch erwähnen, dass Anton jetzt schwimmen kann!',
  },
  {
    family: 'Schmid',
    street: 'Lindenweg 9',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.8931, 11.8512],
    children: 2,
    krampus: false,
    slot: [0, '18:00'],
    hidingPlace: 'Briefkasten-Bank am Gartentor',
  },
  {
    family: 'Hofmann',
    street: 'Aschbacher Straße 41',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9046, 11.8115],
    children: 2,
    krampus: true,
    slot: [0, '18:30'],
    hidingPlace: 'Schubkarre neben der Haustür',
  },
  {
    family: 'Weber',
    street: 'Am Kirchberg 2',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9298, 11.8642],
    children: 1,
    krampus: false,
    slot: [0, '18:30'],
    tags: ['Leitung'],
    hidingPlace: 'Hinter dem Blumenkübel',
  },
  {
    family: 'Berger',
    street: 'Höhenrainer Straße 18',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9223, 11.8401],
    children: 3,
    krampus: false,
    slot: [0, '19:00'],
    hidingPlace: 'Holzlege',
  },
  {
    family: 'Fischer',
    street: 'Vagener Straße 7',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.8781, 11.8869],
    children: 2,
    krampus: true,
    slot: [0, '19:30'],
    tags: ['Pfadfinder'],
    hidingPlace: 'Im Auto (unversperrt) vor dem Haus',
  },
  {
    family: 'Pichler',
    street: 'Einöde 3',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: null,
    children: 1,
    krampus: false,
    slot: [0, '20:00'],
    addressNotes: 'Einzelhof, Zufahrt über den Feldweg nach der Kapelle, ca. 300 m',
    hidingPlace: 'Stall, linke Tür',
  },
  {
    family: 'Steiner',
    street: 'Mangfallstraße 30',
    postalCode: '83052',
    city: 'Bruckmühl',
    at: [47.8789, 11.9122],
    children: 2,
    krampus: false,
    slot: [0, '20:00'],
    hidingPlace: 'Garderobe im Hausflur',
  },
  {
    family: 'Moser',
    street: 'Rosenheimer Straße 55',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9061, 11.8556],
    children: 2,
    krampus: true,
    slot: [0, '18:00'],
    status: 'pending',
  },
  {
    family: 'Leitner',
    street: 'Bergstraße 15',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9132, 11.8402],
    children: 1,
    krampus: false,
    slot: [0, '19:00'],
    status: 'cancelled',
  },
  // Second day, three teams
  {
    family: 'Holzner',
    street: 'Wendelsteinstraße 4',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.8961, 11.8401],
    children: 3,
    krampus: true,
    slot: [1, '17:00'],
    tags: ['Wölflinge', 'Jungpfadfinder'],
    hidingPlace: 'Fahrradschuppen',
  },
  {
    family: 'Aigner',
    street: 'Kapellenweg 12',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9271, 11.8711],
    children: 2,
    krampus: false,
    slot: [1, '17:00'],
    hidingPlace: 'Hinter der Haustür im Windfang',
  },
  {
    family: 'Brunner',
    street: 'Hochriesstraße 8',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9083, 11.8389],
    children: 1,
    krampus: false,
    slot: [1, '17:30'],
    hidingPlace: 'Gartenbank',
  },
  {
    family: 'Lechner',
    street: 'Brunnenweg 11',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9011, 11.8601],
    children: 5,
    krampus: true,
    slot: [1, '18:00'],
    tags: ['Rover'],
    hidingPlace: 'Werkstatt neben der Garage',
    notes: 'Bitte mit Krampus, aber nicht zu wild – die Zwillinge sind erst drei.',
  },
  {
    family: 'Obermaier',
    street: 'Kolbermoorer Straße 21',
    postalCode: '83052',
    city: 'Bruckmühl',
    at: [47.8812, 11.9201],
    children: 2,
    krampus: false,
    slot: [1, '18:00'],
    approximate: true,
    hidingPlace: 'Briefkasten',
  },
  {
    family: 'Kammerer',
    street: 'Unterlauser Weg 5',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.8869, 11.8247],
    children: 2,
    krampus: false,
    slot: [1, '18:30'],
    hidingPlace: 'Gartentor, Tasche hängt innen',
  },
  {
    family: 'Strasser',
    street: 'Großhöhenrain 17',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9311, 11.8615],
    children: 3,
    krampus: true,
    slot: [1, '19:00'],
    hidingPlace: 'Holzstoß an der Hausecke',
  },
  {
    family: 'Wimmer',
    street: 'Kirchdorfer Straße 3',
    postalCode: '83052',
    city: 'Bruckmühl',
    at: [47.8921, 11.9055],
    children: 1,
    krampus: false,
    slot: [1, '19:30'],
    hidingPlace: 'Garage',
  },
  {
    family: 'Hartl',
    street: 'Ellmosener Straße 9',
    postalCode: '83043',
    city: 'Bad Aibling',
    at: [47.8641, 12.0096],
    children: 2,
    krampus: false,
    slot: [1, '20:00'],
    notes: 'Wir wohnen knapp außerhalb – falls es nicht passt, bitte kurz melden.',
    hidingPlace: 'Vor der Haustür in der Kiste',
  },
  {
    family: 'Gruber',
    street: 'Aiblinger Straße 2',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9078, 11.8519],
    children: 2,
    krampus: true,
    slot: [1, '20:00'],
    tags: ['Leitung', 'Pfadfinder'],
    hidingPlace: 'Hinter dem Haus',
  },
  {
    family: 'Kaiser',
    street: 'Feldweg 1',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9001, 11.8333],
    children: 1,
    krampus: false,
    slot: [1, '19:00'],
    status: 'pending',
  },
  {
    family: 'Ziegler',
    street: 'Sonnenstraße 6',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9122, 11.8572],
    children: 2,
    krampus: false,
    slot: [1, '17:30'],
    status: 'expired',
  },
  {
    family: 'Ostermann',
    street: 'Am Weiher 4',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    at: [47.9183, 11.8501],
    children: 3,
    krampus: true,
    slot: [1, '18:30'],
    status: 'cancelled',
  },
];

function toBooking(seed: BookingSeed, index: number): MockNikolausBooking {
  const id = String(100 + index);
  const status = seed.status ?? 'confirmed';
  const slotKey = `${DAYS[seed.slot[0]]}T${seed.slot[1]}`;
  const mail = `familie.${seed.family.toLowerCase()}@example.org`;
  return {
    id,
    etag: newEtag(`nik-${id}`),
    slotKey,
    status,
    familyName: seed.family,
    email: mail,
    phone: `0171 ${String(1000000 + ((index * 7919) % 8999999))}`,
    street: seed.street,
    postalCode: seed.postalCode,
    city: seed.city,
    addressNotes: seed.addressNotes ?? '',
    childrenCount: seed.children,
    withKrampus: seed.krampus,
    hidingPlace: seed.hidingPlace ?? 'Vor der Haustür',
    notes: seed.notes ?? '',
    location: seed.at
      ? { lat: seed.at[0], lon: seed.at[1], approximate: seed.approximate === true }
      : null,
    reservedUntil:
      status === 'pending' ? isoFromNow(0.06) : status === 'expired' ? isoFromNow(-3) : null,
    confirmedAt: status === 'confirmed' ? isoFromNow(-20 + index * 0.5) : null,
    changedAt: index % 5 === 0 ? isoFromNow(-4) : null,
    internalTags: seed.tags ?? [],
  };
}

export const bookings: MockNikolausBooking[] = SEEDS.map(toBooking);

/** Returns the staff view including the loaded booking version. */
export function toStaff(b: MockNikolausBooking): StaffNikolausBooking {
  return { ...b };
}

function isBlocking(b: MockNikolausBooking): boolean {
  return (
    b.status === 'confirmed' ||
    (b.status === 'pending' && !!b.reservedUntil && Date.parse(b.reservedUntil) > MOCK_NOW)
  );
}

function takenBySlot(): Map<string, number> {
  const taken = new Map<string, number>();
  for (const b of bookings) {
    if (isBlocking(b)) taken.set(b.slotKey, (taken.get(b.slotKey) ?? 0) + 1);
  }
  return taken;
}

export function staffOverview(): StaffNikolausOverview {
  const taken = takenBySlot();
  return {
    slots: getNikolausSlots(CONFIG).map((s) => ({
      key: s.key,
      date: s.date,
      time: s.time,
      endTime: s.endTime,
      capacity: s.capacity,
      taken: taken.get(s.key) ?? 0,
    })),
    bookings: bookings.map(toStaff),
  };
}

export function publicSlots(): NikolausSlot[] {
  const taken = takenBySlot();
  return getNikolausSlots(CONFIG).map((s) => ({
    key: s.key,
    date: s.date,
    time: s.time,
    endTime: s.endTime,
    capacity: s.capacity,
    available: Math.max(0, s.capacity - (taken.get(s.key) ?? 0)),
    closed: false,
  }));
}

export function slotExists(key: string): boolean {
  return getNikolausSlots(CONFIG).some((s) => s.key === key);
}

export function createBooking(input: Record<string, unknown>): MockNikolausBooking {
  const text = (key: string): string => (typeof input[key] === 'string' ? String(input[key]) : '');
  const id = newId();
  const booking: MockNikolausBooking = {
    id,
    etag: newEtag(`nik-${id}`),
    slotKey: text('slot'),
    status: 'pending',
    familyName: text('familyName'),
    email: text('email'),
    phone: text('phone'),
    street: text('street'),
    postalCode: text('postalCode'),
    city: text('city'),
    addressNotes: text('addressNotes'),
    childrenCount: typeof input.childrenCount === 'number' ? input.childrenCount : 1,
    withKrampus: input.withKrampus === true,
    hidingPlace: text('hidingPlace'),
    notes: text('notes'),
    location: geocode(text('street'), text('postalCode'), text('city')),
    reservedUntil: isoFromNow(CONFIG.pendingHoldMinutes / (24 * 60)),
    confirmedAt: null,
    changedAt: null,
    internalTags: [],
  };
  bookings.push(booking);
  return booking;
}

/** Fake geocoding: a stable point near the base, derived from the address. */
export function geocode(
  street: string,
  postalCode: string,
  city: string
): { lat: number; lon: number; approximate: boolean } | null {
  if (!street.trim() && !city.trim()) return null;
  const key = `${street}|${postalCode}|${city}`.toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const lat = BASE.lat + ((h % 1000) / 1000 - 0.5) * 0.05;
  const lon = BASE.lon + (((h >> 10) % 1000) / 1000 - 0.5) * 0.08;
  return {
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    approximate: !/\d/.test(street),
  };
}

// ---------------------------------------------------------------------------------------------
// Public booking management (/nikolaus/termin?token=…)

/** Explicit demo tokens for the different booking states. */
const TOKEN_FAMILIES: Record<string, string> = {
  mock: 'Huber',
  pending: 'Moser',
  ausstehend: 'Moser',
  storniert: 'Leitner',
  cancelled: 'Leitner',
  abgelaufen: 'Ziegler',
  expired: 'Ziegler',
  heute: 'Mayr',
};

export function bookingForToken(token: string): MockNikolausBooking | undefined {
  const family = TOKEN_FAMILIES[token.toLowerCase()];
  if (!family) return undefined;
  return bookings.find((b) => b.familyName === family);
}

export function bookingInfo(b: MockNikolausBooking): NikolausBookingInfo {
  const slot = getNikolausSlots(CONFIG).find((s) => s.key === b.slotKey);
  const deadline = slot
    ? new Date(
        localDateTimeToDate(slot.date, slot.time).getTime() -
          CONFIG.changeDeadlineHours * 60 * 60_000
      )
    : null;
  const active = b.status === 'pending' || b.status === 'confirmed';
  return {
    etag: b.etag,
    status: b.status,
    familyName: b.familyName,
    email: b.email,
    phone: b.phone,
    street: b.street,
    postalCode: b.postalCode,
    city: b.city,
    addressNotes: b.addressNotes,
    childrenCount: b.childrenCount,
    withKrampus: b.withKrampus,
    hidingPlace: b.hidingPlace,
    notes: b.notes,
    location: b.location,
    slot: slot ? { key: slot.key, date: slot.date, time: slot.time, endTime: slot.endTime } : null,
    reservedUntil: b.reservedUntil,
    changeDeadline: deadline?.toISOString() ?? null,
    changeDeadlineHours: CONFIG.changeDeadlineHours,
    canChange: active && !!deadline && deadline.getTime() > MOCK_NOW,
  };
}

export function visitProgress(token: string, b: MockNikolausBooking): NikolausVisitProgress {
  if (b.status !== 'confirmed') return { phase: 'none' };
  if (token.toLowerCase() !== 'heute') return { phase: 'before' };
  const row = dispoRows.get(b.slotKey.slice(0, 10))?.find((r) => r.bookingId === b.id);
  const planned = row?.plannedArrival ?? b.slotKey.slice(11);
  const position = row?.order ?? 3;
  return {
    phase: 'today',
    position,
    stopsAhead: Math.max(0, position - 2),
    started: true,
    plannedArrival: planned,
    eta: minutesToTime(timeToMinutes(planned) + 10),
    delayMinutes: 10,
    visited: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Dispo

function confirmedOfDay(date: string): MockNikolausBooking[] {
  return bookings
    .filter((b) => b.status === 'confirmed' && b.slotKey.startsWith(`${date}T`))
    .sort((a, b) => a.slotKey.localeCompare(b.slotKey) || Number(a.id) - Number(b.id));
}

/** Air-line estimate like `api/lib/travel-times.ts` (detour 1.4, 35 km/h, 2 min parking). */
function travelMatrix(points: (NikolausCoordinates | null)[]): number[][] {
  return points.map((from, i) =>
    points.map((to, j) => {
      if (i === j) return 0;
      if (!from || !to) return 10;
      const minutes = (distanceKm(from, to) * 1.4 * 60) / 35;
      return Math.round((minutes + 2) * 10) / 10;
    })
  );
}

function travelOfDay(stops: MockNikolausBooking[]): number[][] {
  return travelMatrix([
    { lat: BASE.lat, lon: BASE.lon },
    ...stops.map((b) => (b.location ? { lat: b.location.lat, lon: b.location.lon } : null)),
  ]);
}

/** Saved Dispo rows per date. */
export const dispoRows = new Map<string, StaffNikolausDispoRow[]>();

export function dispoVersion(rows: StaffNikolausDispoRow[]): string {
  return fingerprint(
    rows
      .map((r) => [r.bookingId, r.team, r.order, r.slotKey, r.plannedArrival, r.fixed].join(':'))
      .sort()
      .join('|')
  );
}

function solveDay(date: string): StaffNikolausDispoRow[] {
  const stops = confirmedOfDay(date);
  const teams = getNikolausTeams(date, CONFIG).map((t) => t.name);
  const problem = {
    stops: stops.map((b) => {
      const start = timeToMinutes(b.slotKey.slice(11));
      return {
        id: b.id,
        slotStart: start,
        slotEnd: start + 30,
        duration: visitMinutes(b.childrenCount),
      };
    }),
    teams,
    travel: travelOfDay(stops),
  };
  const plan = evaluateDispo(problem, solveDispo(problem));
  const slotOf = new Map(stops.map((b) => [b.id, b.slotKey]));
  return plan.routes.flatMap((route) =>
    route.stops.map((stop, i) => ({
      bookingId: stop.id,
      team: route.team,
      order: i + 1,
      slotKey: slotOf.get(stop.id) ?? '',
      plannedArrival: minutesToTime(stop.start),
      // One fixed visit per day shows the pin state in the UI
      fixed: route.team === 'A' && i === 1,
      visited: false,
      visitedAt: '',
    }))
  );
}

for (const date of DAYS) {
  const rows = solveDay(date);
  // A few visits already checked off on the first day, for the Fahrt view
  if (date === DAY1) {
    for (const row of rows.filter((r) => r.team === 'A' && r.order <= 2)) {
      row.visited = true;
      row.visitedAt = minutesToTime(timeToMinutes(row.plannedArrival) + 14);
    }
  }
  dispoRows.set(date, rows);
}

export function saveDispo(
  date: string,
  entries: Omit<StaffNikolausDispoRow, 'visited' | 'visitedAt'>[]
): { rows: StaffNikolausDispoRow[]; version: string } {
  const previous = new Map((dispoRows.get(date) ?? []).map((r) => [r.bookingId, r]));
  const rows = entries.map((e) => ({
    bookingId: e.bookingId,
    team: e.team,
    order: e.order,
    slotKey: e.slotKey,
    plannedArrival: e.plannedArrival,
    fixed: e.fixed,
    visited: previous.get(e.bookingId)?.visited ?? false,
    visitedAt: previous.get(e.bookingId)?.visitedAt ?? '',
  }));
  dispoRows.set(date, rows);
  return { rows, version: dispoVersion(rows) };
}

export function dispoData(date: string): StaffNikolausDispoData {
  const stops = confirmedOfDay(date);
  const rows = dispoRows.get(date) ?? [];
  return {
    date,
    teams: getNikolausTeams(date, CONFIG),
    minutesPerChild: 5,
    minVisitMinutes: 10,
    stops: stops.map(toStaff),
    travel: travelOfDay(stops),
    travelSource: 'route',
    rows,
    version: dispoVersion(rows),
    pendingCount: bookings.filter(
      (b) => b.status === 'pending' && b.slotKey.startsWith(`${date}T`) && isBlocking(b)
    ).length,
    members: teamMembers(date),
  };
}

/** Straight lines base → stops → base, as `[lat, lon]`. */
export function routePaths(
  routes: Record<string, string[]>
): Record<string, [number, number][] | null> {
  const byId = new Map(bookings.map((b) => [b.id, b]));
  return Object.fromEntries(
    Object.entries(routes).map(([team, ids]) => {
      const points = ids.flatMap((id): [number, number][] => {
        const loc = byId.get(id)?.location;
        return loc ? [[loc.lat, loc.lon]] : [];
      });
      if (points.length === 0) return [team, null];
      const base: [number, number] = [BASE.lat, BASE.lon];
      return [team, [base, ...points, base]];
    })
  );
}

export function fahrtData(date: string): StaffNikolausFahrtData {
  const teams = getNikolausTeams(date, CONFIG);
  const confirmed = new Map(confirmedOfDay(date).map((b) => [b.id, b]));
  const routes: Record<string, StaffNikolausFahrtStop[]> = Object.fromEntries(
    teams.map((t) => [t.name, []])
  );
  const rows = dispoRows.get(date) ?? [];
  const planned = new Set<string>();
  let dropped = 0;
  for (const row of rows) {
    const b = confirmed.get(row.bookingId);
    const route = routes[row.team];
    if (!b || !route || planned.has(row.bookingId)) {
      dropped++;
      continue;
    }
    planned.add(row.bookingId);
    route.push({
      bookingId: row.bookingId,
      visitVersion: mockVisitVersion(date, row),
      order: row.order,
      plannedArrival: row.plannedArrival,
      slotKey: b.slotKey,
      moved: row.slotKey !== b.slotKey,
      visited: row.visited,
      visitedAt: row.visitedAt,
      familyName: b.familyName,
      phone: b.phone,
      street: b.street,
      postalCode: b.postalCode,
      city: b.city,
      addressNotes: b.addressNotes,
      childrenCount: b.childrenCount,
      withKrampus: b.withKrampus,
      hidingPlace: b.hidingPlace,
      notes: b.notes,
      location: b.location,
    });
  }
  for (const route of Object.values(routes)) route.sort((a, b) => a.order - b.order);
  const members = teamMembers(date);
  return {
    date,
    teams,
    base: BASE,
    dispoSaved: rows.length > 0,
    routes,
    members: Object.fromEntries(
      Object.entries(members).map(([team, list]) => [
        team,
        list.map((m) => ({ name: m.name, role: m.role })),
      ])
    ),
    unplannedCount: [...confirmed.keys()].filter((id) => !planned.has(id)).length,
    droppedCount: dropped,
  };
}

const visitOperations = new Map<string, string>();
function mockVisitVersion(date: string, row: StaffNikolausDispoRow): string {
  return createHash('sha256')
    .update(JSON.stringify([date, row, visitOperations.get(`${date}:${row.bookingId}`) ?? '']))
    .digest('hex');
}

export function setVisited(
  date: string,
  bookingId: string,
  visited: boolean,
  mutation: { version: string; operationId: string }
): { bookingId: string; visited: boolean; visitedAt: string; visitVersion: string } | undefined {
  const row = dispoRows.get(date)?.find((r) => r.bookingId === bookingId);
  if (!row) return undefined;
  const key = `${date}:${bookingId}`;
  if (visitOperations.get(key) === mutation.operationId && row.visited === visited) {
    return {
      bookingId,
      visited,
      visitedAt: row.visitedAt,
      visitVersion: mockVisitVersion(date, row),
    };
  }
  if (mockVisitVersion(date, row) !== mutation.version) throw new Error('VISIT_CONFLICT');
  visitOperations.set(key, mutation.operationId);
  const now = new Date(MOCK_NOW);
  row.visited = visited;
  row.visitedAt = visited
    ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    : '';
  return {
    bookingId,
    visited,
    visitedAt: row.visitedAt,
    visitVersion: mockVisitVersion(date, row),
  };
}

// ---------------------------------------------------------------------------------------------
// Helfende and Einteilung

interface HelperSeed {
  name: string;
  day1: HelperRole[];
  day2: HelperRole[];
  positive?: string[];
  negative?: string[];
  notes?: string;
}

const HELPER_SEEDS: HelperSeed[] = [
  {
    name: 'Katharina Huber',
    day1: ['Nikolaus', 'Engerl'],
    day2: ['Nikolaus'],
    negative: ['Wölflinge'],
  },
  {
    name: 'Maximilian Gruber',
    day1: ['Nikolaus'],
    day2: ['Nikolaus', 'Fahrer*in'],
    negative: ['Leitung'],
  },
  {
    name: 'Benedikt Hofstetter',
    day1: ['Krampus'],
    day2: ['Krampus', 'Fahrer*in'],
    positive: ['Hund'],
  },
  {
    name: 'Hugo Berendi',
    day1: ['Fahrer*in', 'Krampus'],
    day2: ['Fahrer*in'],
    notes: 'Habe einen VW-Bus mit 8 Sitzen.',
  },
  { name: 'Quirin Maier', day1: ['Krampus'], day2: [], negative: ['Pfadfinder'] },
  { name: 'Theresa Lechner', day1: ['Engerl'], day2: ['Engerl', 'Küche'] },
  { name: 'Felix Steinberger', day1: ['Fahrer*in'], day2: ['Fahrer*in', 'Krampus'] },
  {
    name: 'Anna-Lena Schwaiger',
    day1: ['Engerl', 'Küche'],
    day2: ['Engerl'],
    negative: ['Jungpfadfinder'],
  },
  { name: 'Lena Brandstetter', day1: [], day2: ['Nikolaus', 'Engerl'], negative: ['Wölflinge'] },
  { name: 'Jonas Obermaier', day1: ['Küche'], day2: ['Krampus'] },
  { name: 'Magdalena Strasser', day1: ['Küche'], day2: ['Küche'], notes: 'Nur bis 20 Uhr.' },
  {
    name: 'Georg Huber (Papa Lena)',
    day1: ['Fahrer*in'],
    day2: [],
    notes: 'Kein Pfadfinder, fährt aber gerne.',
  },
  { name: 'Sophie Kammerer', day1: ['Engerl'], day2: ['Engerl'] },
  { name: 'Tobias Weiß', day1: ['Krampus', 'Fahrer*in'], day2: ['Krampus'], positive: ['Rover'] },
  { name: 'Pfarrer Thomas Wimmer', day1: [], day2: ['Nikolaus'], positive: ['Leitung'] },
  { name: 'Marlene Fuchs', day1: ['Küche'], day2: ['Fahrer*in', 'Küche'] },
];

export const helpers: StaffNikolausHelper[] = HELPER_SEEDS.map((seed, i) => {
  const id = String(300 + i);
  return {
    id,
    etag: newEtag(`helper-${id}`),
    name: seed.name,
    availability: { [DAY1]: seed.day1, [DAY2]: seed.day2 },
    positiveTags: seed.positive ?? [],
    negativeTags: seed.negative ?? [],
    notes: seed.notes ?? '',
  };
});

function einteilungDays(): EinteilungDay[] {
  const confirmed = new Map(bookings.filter((b) => b.status === 'confirmed').map((b) => [b.id, b]));
  return DAYS.map((date) => {
    const teams = getNikolausTeams(date, CONFIG).map((t) => t.name);
    const rows = dispoRows.get(date) ?? [];
    if (rows.length === 0) return { date, teams, familyTags: null };
    const familyTags: Record<string, string[][]> = Object.fromEntries(teams.map((t) => [t, []]));
    for (const row of rows) {
      const b = confirmed.get(row.bookingId);
      if (b && familyTags[row.team]) familyTags[row.team].push(b.internalTags);
    }
    return { date, teams, familyTags };
  });
}

export let einteilungRows: StaffNikolausEinteilungRow[] = solveEinteilung({
  persons: helpers,
  days: einteilungDays(),
}).assignments.map((a, i) => ({
  personId: a.personId,
  date: a.date,
  team: a.team,
  role: a.role,
  // The first Nikolaus of the first day is set by hand
  fixed: i === 0 && a.role === 'Nikolaus',
}));

export function einteilungVersion(rows: StaffNikolausEinteilungRow[]): string {
  return fingerprint(
    rows
      .map((r) => [r.personId, r.date, r.team, r.role, r.fixed].join(':'))
      .sort()
      .join('|')
  );
}

export function saveEinteilung(rows: StaffNikolausEinteilungRow[]): {
  rows: StaffNikolausEinteilungRow[];
  version: string;
} {
  einteilungRows = rows;
  return { rows, version: einteilungVersion(rows) };
}

function teamMembers(date: string): Record<string, StaffNikolausTeamMember[]> {
  const byId = new Map(helpers.map((h) => [h.id, h]));
  const members: Record<string, StaffNikolausTeamMember[]> = {};
  for (const row of einteilungRows) {
    const h = byId.get(row.personId);
    if (row.date !== date || row.team === KITCHEN || !h) continue;
    (members[row.team] ??= []).push({
      personId: h.id,
      name: h.name,
      role: row.role,
      negativeTags: h.negativeTags,
      positiveTags: h.positiveTags,
    });
  }
  const rank = (role: string): number => HELPER_ROLES.indexOf(role as HelperRole);
  for (const list of Object.values(members)) list.sort((a, b) => rank(a.role) - rank(b.role));
  return members;
}

export function helfendeData(): StaffNikolausHelfendeData {
  const tags = new Map<string, string>();
  for (const tag of [
    ...helpers.flatMap((h) => [...h.positiveTags, ...h.negativeTags]),
    ...bookings.flatMap((b) => b.internalTags),
  ]) {
    if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  }
  return {
    persons: helpers,
    tags: [...tags.values()].sort((a, b) => a.localeCompare(b, 'de')),
    days: DAYS.map((date) => ({ date, teams: getNikolausTeams(date, CONFIG).map((t) => t.name) })),
  };
}

export function einteilungData(): StaffNikolausEinteilungData {
  return {
    persons: helpers,
    days: einteilungDays(),
    rows: einteilungRows,
    version: einteilungVersion(einteilungRows),
  };
}

export function upsertHelper(
  id: string | null,
  body: Record<string, unknown>
): StaffNikolausHelper {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  const availability: Record<string, HelperRole[]> = {};
  const raw = body.availability;
  if (raw && typeof raw === 'object') {
    for (const [date, roles] of Object.entries(raw as Record<string, unknown>)) {
      availability[date] = strings(roles).filter((r): r is HelperRole =>
        (HELPER_ROLES as string[]).includes(r)
      );
    }
  }
  const existing = id ? helpers.find((h) => h.id === id) : undefined;
  const next: StaffNikolausHelper = {
    id: existing?.id ?? newId(),
    etag: newEtag(`helper-${id ?? 'new'}`),
    name: typeof body.name === 'string' ? body.name : (existing?.name ?? ''),
    availability,
    positiveTags: strings(body.positiveTags),
    negativeTags: strings(body.negativeTags),
    notes: typeof body.notes === 'string' ? body.notes : '',
  };
  if (existing) Object.assign(existing, next);
  else helpers.push(next);
  return existing ?? next;
}

export function deleteHelper(id: string): boolean {
  const index = helpers.findIndex((h) => h.id === id);
  if (index < 0) return false;
  helpers.splice(index, 1);
  einteilungRows = einteilungRows.filter((r) => r.personId !== id);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Stufen-Abgleich

function family(name: string): MockNikolausBooking {
  const b = bookings.find((x) => x.familyName === name);
  if (!b) throw new Error(`Mock booking ${name} missing`);
  return b;
}

function helper(name: string): StaffNikolausHelper {
  const h = helpers.find((x) => x.name === name);
  if (!h) throw new Error(`Mock helper ${name} missing`);
  return h;
}

export const stufenSuggestions: StaffNikolausStufenSuggestion[] = [
  {
    id: 's1',
    kind: 'booking',
    targetId: family('Bauer').id,
    targetName: `Familie ${family('Bauer').familyName}`,
    stufe: 'Wölflinge',
    match: 'name-address',
    evidence: ['Mia Bauer (Wölflinge), Birkenstraße 14'],
  },
  {
    id: 's2',
    kind: 'booking',
    targetId: family('Fischer').id,
    targetName: `Familie ${family('Fischer').familyName}`,
    stufe: 'Jungpfadfinder',
    match: 'address',
    evidence: ['Ben Wagner (Jungpfadfinder), Vagener Straße 7 – anderer Nachname'],
  },
  {
    id: 's3',
    kind: 'booking',
    targetId: family('Strasser').id,
    targetName: `Familie ${family('Strasser').familyName}`,
    stufe: 'Pfadfinder',
    match: 'name-address',
    evidence: [
      'Korbinian Strasser (Pfadfinder), Großhöhenrain 17',
      'Xaver Strasser (Pfadfinder), Großhöhenrain 17',
    ],
  },
  {
    id: 's4',
    kind: 'helper',
    targetId: helper('Felix Steinberger').id,
    targetName: 'Felix Steinberger',
    stufe: 'Jungpfadfinder',
    match: 'leitung',
    evidence: ['Leitet laut Leitende-Liste die Jungpfadfinder'],
  },
  {
    id: 's5',
    kind: 'helper',
    targetId: helper('Theresa Lechner').id,
    targetName: 'Theresa Lechner',
    stufe: 'Pfadfinder',
    match: 'leitung',
    evidence: ['Leitet laut Leitende-Liste die Pfadfinder'],
  },
];

// ---------------------------------------------------------------------------------------------
// Steuerung

let steuerungVersion = 1;
const auditLog: NikolausAuditEntry[] = [];

export function steuerungEtag(): string {
  return `"steuerung-${steuerungVersion}"`;
}

export function steuerungView(): StaffNikolausSteuerung {
  const confirmed = bookings
    .filter((b) => b.status === 'confirmed')
    .map((b) => b.slotKey.slice(0, 10));
  const lastVisit = confirmed.sort().at(-1) ?? null;
  return {
    settings: structuredClone(CONFIG),
    etag: steuerungEtag(),
    updatedAt: new Date(MOCK_NOW).toISOString(),
    updatedBy: '',
    cleanup: {
      bookings: bookings.length,
      dispoVisits: [...dispoRows.values()].reduce((sum, rows) => sum + rows.length, 0),
      helpers: helpers.length,
      assignments: einteilungRows.length,
      lastVisit,
      deleteBy: lastVisit ? '2027-01-06' : null,
      due: false,
    },
    confirmations: { bookings: 'ANMELDUNGEN LÖSCHEN', helpers: 'HELFENDE LÖSCHEN' },
    geocoding: { owner: null, startedAt: null },
    log: [...auditLog].reverse(),
  };
}

/** Applies settings of the Steuerung; the mock checks nothing but the version. */
export function saveSteuerung(settings: NikolausSettings, actor: string): void {
  Object.assign(CONFIG, structuredClone(settings));
  steuerungVersion++;
  auditLog.push({
    id: auditLog.length + 1,
    at: new Date().toISOString(),
    actor,
    action: 'settings',
    details: { changes: {} },
  });
}

export function deleteSteuerungData(scope: 'bookings' | 'helpers', actor: string): void {
  if (scope === 'bookings') {
    bookings.splice(0);
    dispoRows.clear();
  } else {
    helpers.splice(0);
    einteilungRows = [];
  }
  auditLog.push({
    id: auditLog.length + 1,
    at: new Date().toISOString(),
    actor,
    action: `delete-${scope}`,
    details: { deleted: {} },
  });
}
