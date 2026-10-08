import { formatName, personStatus } from './campflowFields';
import { mapGroupToStufe } from './campflowGroups';
import type { CampflowColumn, CampflowPerson } from './types';

export type Fahrt = 'hin' | 'rueck';

export const FAHRTEN: readonly Fahrt[] = ['hin', 'rueck'];

export const FAHRT_LABEL: Record<Fahrt, string> = { hin: 'Hinfahrt', rueck: 'Rückfahrt' };

/** A participant who rides along or drives; `plaetze` counts the seats including the driver's. */
export interface FahrtPerson {
  id: string;
  name: string;
  nachname: string;
  gruppe: string;
  plaetze: Record<Fahrt, number>;
}

export interface Auto {
  fahrer: FahrtPerson;
  /** Seats including the driver's. */
  plaetze: number;
  mitfahrende: FahrtPerson[];
}

export interface FahrtPlan {
  fahrt: Fahrt;
  autos: Auto[];
  /** Participants without a seat; their parents bring them. */
  ohnePlatz: FahrtPerson[];
  /** Participants taken out of this plan by hand. */
  entfernt: FahrtPerson[];
}

/** Manual changes to the automatic plan of one direction; all entries are person ids. */
export interface FahrtAnpassungen {
  /** Drive in any case, if they offered seats. */
  fahrer: string[];
  /** Offered seats, but should not drive. */
  keinFahrer: string[];
  entfernt: string[];
  /** Person → driver they ride with, or `null` for no seat; applied in this order. */
  verschoben: [person: string, fahrer: string | null][];
}

export const KEINE_ANPASSUNGEN: FahrtAnpassungen = {
  fahrer: [],
  keinFahrer: [],
  entfernt: [],
  verschoben: [],
};

/** Free passenger seats of a car. */
export function freiePlaetze(auto: Auto): number {
  return auto.plaetze - 1 - auto.mitfahrende.length;
}

function parseSeats(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(',', '.').trim())
        : NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

/** Value of a custom column; CampFlow sends it as `col_…` or `custom_{external_id}`. */
function columnValue(person: CampflowPerson, column: CampflowColumn | undefined): unknown {
  if (!column) return undefined;
  return person[column.id] ?? (column.external_id ? person[`custom_${column.external_id}`] : null);
}

const SEAT_COLUMN_PATTERN: Record<Fahrt, RegExp> = {
  hin: /hinfahrt|\bhin\b/i,
  rueck: /rückfahrt|rueckfahrt|heimfahrt|\brück\b/i,
};

/** The custom column that most likely holds the seats offered for a direction, or `''`. */
export function guessSeatColumn(columns: CampflowColumn[], fahrt: Fahrt): string {
  return columns.find((column) => SEAT_COLUMN_PATTERN[fahrt].test(column.name))?.id ?? '';
}

/** Participants who have not cancelled, with the seats from the chosen columns. */
export function fahrtPersonen(
  persons: CampflowPerson[],
  columns: CampflowColumn[],
  seatColumns: Record<Fahrt, string>
): FahrtPerson[] {
  const hin = columns.find((column) => column.id === seatColumns.hin);
  const rueck = columns.find((column) => column.id === seatColumns.rueck);
  return persons
    .filter((person) => personStatus(person) !== 'cancelled')
    .map((person) => {
      const lastName =
        typeof person.name === 'object' && person.name !== null && 'last_name' in person.name
          ? person.name.last_name
          : null;
      const groups = Array.isArray(person.group_names) ? person.group_names : [];
      return {
        id: person.id,
        name: formatName(person),
        nachname: typeof lastName === 'string' ? lastName.trim() : '',
        gruppe: typeof groups[0] === 'string' ? groups[0] : '',
        plaetze: {
          hin: parseSeats(columnValue(person, hin)),
          rueck: parseSeats(columnValue(person, rueck)),
        },
      };
    });
}

const LEITENDE_PATTERN = /leitend|externe|ehemalige/i;

/**
 * Lower is preferred as driver and as company: Leitende, then Rover, then the other Stufen,
 * then everyone else.
 */
function tier(person: FahrtPerson): number {
  if (LEITENDE_PATTERN.test(person.gruppe)) return 0;
  const stufe = mapGroupToStufe(person.gruppe);
  if (stufe === 'Rover') return 1;
  return stufe ? 2 : 3;
}

function isLeitende(person: FahrtPerson): boolean {
  return tier(person) === 0;
}

const STUFE_SENIORITY: Record<string, number> = {
  Wölflinge: 1,
  Jungpfadfinder: 2,
  Pfadfinder: 3,
  Rover: 4,
};

/** Higher means older company in the car: Leitende, then Rover down to Wölflinge. */
function seniority(person: FahrtPerson): number {
  if (isLeitende(person)) return 5;
  return STUFE_SENIORITY[mapGroupToStufe(person.gruppe) ?? ''] ?? 0;
}

function familyName(person: FahrtPerson): string {
  return person.nachname.toLocaleLowerCase('de');
}

/** Takes the child from `remaining` who fits best: same Stufe as the driver, same family. */
function pickPassenger(
  driver: FahrtPerson,
  remaining: FahrtPerson[],
  inCar: FahrtPerson[]
): FahrtPerson | undefined {
  const driverTier = tier(driver);
  const inCarFamilies = new Set([familyName(driver), ...inCar.map(familyName)].filter(Boolean));
  const familySizes = new Map<string, number>();
  for (const person of remaining) {
    const family = familyName(person);
    if (family) familySizes.set(family, (familySizes.get(family) ?? 0) + 1);
  }
  const tierCounts = new Map<number, number>();
  for (const person of inCar) tierCounts.set(tier(person), (tierCounts.get(tier(person)) ?? 0) + 1);
  let dominantTier: number | null = null;
  let dominantCount = 0;
  for (const [candidateTier, count] of tierCounts) {
    if (count > dominantCount) {
      dominantTier = candidateTier;
      dominantCount = count;
    }
  }

  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  remaining.forEach((candidate, index) => {
    const candidateTier = tier(candidate);
    const family = familyName(candidate);
    let score = candidateTier === driverTier ? 50 : -12;
    if (dominantTier !== null && candidateTier === dominantTier) {
      score += dominantTier === driverTier ? 12 : 4;
    }
    // Outranks any Stufe match, so siblings from different Stufen still share a car
    if (family && inCarFamilies.has(family)) score += 100;
    if (family && (familySizes.get(family) ?? 0) > 1) score += inCar.length === 0 ? 18 : 10;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex === -1 ? undefined : remaining.splice(bestIndex, 1)[0];
}

/** Moves single passengers into fuller cars, so nobody sits alone with a driver if avoidable. */
function joinSinglePassengers(autos: Auto[]): void {
  for (;;) {
    // A Leitende passenger already sits in the best car left for them
    const source = autos.find(
      (auto) => auto.mitfahrende.length === 1 && !isLeitende(auto.mitfahrende[0])
    );
    if (!source) return;
    const target = autos
      .filter((auto) => auto !== source && auto.mitfahrende.length > 0 && freiePlaetze(auto) > 0)
      .sort((a, b) => b.mitfahrende.length - a.mitfahrende.length)[0];
    if (!target) return;
    target.mitfahrende.push(...source.mitfahrende.splice(0));
  }
}

/**
 * Plans one direction: as few drivers as possible, larger cars first, then Leitende before
 * Rover before the other Stufen. Leitende ride with Leitende, otherwise with the oldest Stufe.
 * Everyone appears exactly once: as driver, passenger, without seat or removed.
 */
export function planFahrt(
  personen: FahrtPerson[],
  fahrt: Fahrt,
  anpassungen: FahrtAnpassungen = KEINE_ANPASSUNGEN
): FahrtPlan {
  const removed = new Set(anpassungen.entfernt);
  const forced = new Set(anpassungen.fahrer);
  // Someone placed by hand rides along, unless they are set to drive
  const notDriving = new Set([
    ...anpassungen.keinFahrer,
    ...anpassungen.verschoben.map(([person]) => person).filter((id) => !forced.has(id)),
  ]);
  const active = personen.filter((person) => !removed.has(person.id));

  const candidates = active
    .filter((person) => person.plaetze[fahrt] > 0 && !notDriving.has(person.id))
    .sort(
      (a, b) =>
        b.plaetze[fahrt] - a.plaetze[fahrt] || tier(a) - tier(b) || a.name.localeCompare(b.name)
    );
  const drivers = candidates.filter((person) => forced.has(person.id));
  let seats = drivers.reduce((sum, person) => sum + person.plaetze[fahrt], 0);
  for (const person of candidates) {
    if (seats >= active.length) break;
    if (forced.has(person.id)) continue;
    drivers.push(person);
    seats += person.plaetze[fahrt];
  }

  const passengers = active.filter((person) => !drivers.includes(person));
  const leitende = passengers.filter(isLeitende);
  const remaining = passengers.filter((person) => !isLeitende(person));
  const autos: Auto[] = drivers.map((fahrer) => ({
    fahrer,
    plaetze: fahrer.plaetze[fahrt],
    mitfahrende: [],
  }));
  // Leitende first, into the cars with the oldest company; the sort keeps larger cars first
  for (const auto of [...autos].sort((a, b) => seniority(b.fahrer) - seniority(a.fahrer))) {
    auto.mitfahrende.push(...leitende.splice(0, freiePlaetze(auto)));
  }
  for (const auto of autos) {
    while (freiePlaetze(auto) > 0) {
      const passenger = pickPassenger(auto.fahrer, remaining, auto.mitfahrende);
      if (!passenger) break;
      auto.mitfahrende.push(passenger);
    }
  }
  joinSinglePassengers(autos);

  const plan: FahrtPlan = {
    fahrt,
    autos,
    ohnePlatz: [...leitende, ...remaining],
    entfernt: personen.filter((person) => removed.has(person.id)),
  };
  for (const [person, fahrer] of anpassungen.verschoben) move(plan, person, fahrer);
  return plan;
}

/** Moves a passenger to a driver with a free seat, or to no seat; other moves are ignored. */
function move(plan: FahrtPlan, personId: string, fahrerId: string | null): void {
  const target = fahrerId === null ? null : plan.autos.find((auto) => auto.fahrer.id === fahrerId);
  if (target === undefined || (target && freiePlaetze(target) <= 0)) return;
  const lists = [plan.ohnePlatz, ...plan.autos.map((auto) => auto.mitfahrende)];
  const source = lists.find((list) => list.some((person) => person.id === personId));
  if (!source) return;
  const [person] = source.splice(
    source.findIndex((p) => p.id === personId),
    1
  );
  (target ? target.mitfahrende : plan.ohnePlatz).push(person);
}

/** Sets where a passenger rides; an earlier move of the same person is replaced. */
export function withMove(
  anpassungen: FahrtAnpassungen,
  personId: string,
  fahrerId: string | null
): FahrtAnpassungen {
  return {
    ...anpassungen,
    verschoben: [...anpassungen.verschoben.filter(([id]) => id !== personId), [personId, fahrerId]],
  };
}

/** Lets a person drive in any case, or keeps them from driving. */
export function withDriver(
  anpassungen: FahrtAnpassungen,
  personId: string,
  drives: boolean
): FahrtAnpassungen {
  const without = (ids: string[]): string[] => ids.filter((id) => id !== personId);
  return {
    ...anpassungen,
    fahrer: drives ? [...without(anpassungen.fahrer), personId] : without(anpassungen.fahrer),
    keinFahrer: drives
      ? without(anpassungen.keinFahrer)
      : [...without(anpassungen.keinFahrer), personId],
    verschoben: anpassungen.verschoben.filter(
      ([id, fahrer]) => id !== personId && fahrer !== personId
    ),
  };
}

/** Takes a person out of the plan, or back in. */
export function withRemoved(
  anpassungen: FahrtAnpassungen,
  personId: string,
  removed: boolean
): FahrtAnpassungen {
  const without = (ids: string[]): string[] => ids.filter((id) => id !== personId);
  return {
    fahrer: without(anpassungen.fahrer),
    keinFahrer: without(anpassungen.keinFahrer),
    entfernt: removed
      ? [...without(anpassungen.entfernt), personId]
      : without(anpassungen.entfernt),
    verschoben: anpassungen.verschoben.filter(
      ([id, fahrer]) => id !== personId && fahrer !== personId
    ),
  };
}

const PARAM = {
  fahrer: 'fahrer',
  keinFahrer: 'kein-fahrer',
  entfernt: 'entfernt',
  verschoben: 'mit',
} as const;

function param(name: string, fahrt: Fahrt): string {
  return `${name}-${fahrt}`;
}

function idList(value: string | null): string[] {
  return (value ?? '').split(',').filter(Boolean);
}

/** Reads the changes of a direction from the URL, so a plan can be shared as a link. */
export function readAnpassungen(params: URLSearchParams, fahrt: Fahrt): FahrtAnpassungen {
  return {
    fahrer: idList(params.get(param(PARAM.fahrer, fahrt))),
    keinFahrer: idList(params.get(param(PARAM.keinFahrer, fahrt))),
    entfernt: idList(params.get(param(PARAM.entfernt, fahrt))),
    verschoben: idList(params.get(param(PARAM.verschoben, fahrt))).map((entry) => {
      const [person, fahrer = '-'] = entry.split(':');
      return [person, fahrer === '-' ? null : fahrer];
    }),
  };
}

/** Writes the changes of a direction into the URL parameters; empty lists are left out. */
export function writeAnpassungen(
  params: URLSearchParams,
  fahrt: Fahrt,
  anpassungen: FahrtAnpassungen
): void {
  const lists: [string, string[]][] = [
    [PARAM.fahrer, anpassungen.fahrer],
    [PARAM.keinFahrer, anpassungen.keinFahrer],
    [PARAM.entfernt, anpassungen.entfernt],
    [
      PARAM.verschoben,
      anpassungen.verschoben.map(([person, fahrer]) => `${person}:${fahrer ?? '-'}`),
    ],
  ];
  for (const [name, values] of lists) {
    if (values.length > 0) params.set(param(name, fahrt), values.join(','));
    else params.delete(param(name, fahrt));
  }
}

/** Rows for the CSV export of both directions. */
export function fahrtenRows(plans: FahrtPlan[]): string[][] {
  const rows = [['Fahrt', 'Rolle', 'Name', 'Gruppe', 'Fährt bei', 'Plätze']];
  for (const plan of plans) {
    const fahrt = FAHRT_LABEL[plan.fahrt];
    for (const auto of plan.autos) {
      const fahrer = auto.fahrer.name;
      rows.push([fahrt, 'Fahrer*in', fahrer, auto.fahrer.gruppe, fahrer, String(auto.plaetze)]);
      for (const person of auto.mitfahrende) {
        rows.push([fahrt, 'Mitfahrend', person.name, person.gruppe, fahrer, '']);
      }
    }
    for (const person of plan.ohnePlatz) {
      rows.push([fahrt, 'Ohne Platz', person.name, person.gruppe, '', '']);
    }
    for (const person of plan.entfernt) {
      rows.push([fahrt, 'Nicht eingeplant', person.name, person.gruppe, '', '']);
    }
  }
  return rows;
}
