/**
 * Fills the Nikolaus booking list with invented, confirmed test bookings until every slot of
 * the configuration is fully booked, or removes them again.
 *
 * Run locally in `api/` with the values of `local.settings.json`:
 *   bun scripts/nikolaus-testdata.ts --dry-run   shows what would be created
 *   bun scripts/nikolaus-testdata.ts             creates the bookings
 *   bun scripts/nikolaus-testdata.ts --links <file>
 *                                                also writes the management links of the created
 *                                                bookings into <file> (keep it out of the repo)
 *   bun scripts/nikolaus-testdata.ts --delete    deletes all test bookings (and their Dispo rows)
 *   bun scripts/nikolaus-testdata.ts --helfende [--dry-run|--delete]
 *                                                the same for about 30 invented helpers
 *
 * About a quarter of the test families get a group tag (e.g. „Wölflinge“); some helpers get
 * matching negative or positive tags, so the Einteilung has something to respect.
 * Test bookings are recognised by their e-mail domain `nikolaus-test.invalid`; `.invalid` is
 * reserved and never exists, so no mail can reach anybody. Addresses are real streets found by
 * reverse geocoding random points around the base (OpenStreetMap Nominatim, 1 request/s).
 * The families are invented; phone numbers come from the range the Bundesnetzagentur reserves
 * for fiction ((089) 99998-000 to -999).
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import type { NikolausBookingDetails } from '../lib/nikolaus-validation';
import {
  dateFields,
  detailFields,
  getAllBookings,
  hashToken,
  isBlocking,
} from '../lib/nikolaus-bookings';
import { NIKOLAUS_CONFIG, getNikolausSlots, slotKeyToDate } from '../lib/nikolaus-config';
import {
  createSharePointListItem,
  deleteSharePointListItem,
  getSharePointListItems,
} from '../lib/sharepoint-data-access';
import { EnvironmentVariable, getEnvironment } from '../lib/environment';
import type { HelperRole } from '../lib/nikolaus-einteilung';
import { HELPER_ROLES } from '../lib/nikolaus-einteilung';
import type { Helper } from '../lib/nikolaus-helfende-list';
import { createHelper, deleteHelper, getHelpers } from '../lib/nikolaus-helfende-list';
import { deleteEinteilungOfPerson } from '../lib/nikolaus-einteilung-list';

export const TEST_EMAIL_DOMAIN = 'nikolaus-test.invalid';

/** Test helpers are recognised by this start of their notes. */
const TEST_HELPER_MARK = '[Test]';
const TEST_HELPER_COUNT = 30;

/** Internal tags for families with children in one of our groups. */
const GROUP_TAGS = ['Wölflinge', 'Jupfis', 'Pfadis', 'Rover'];

const FIRST_NAMES = [
  'Anna',
  'Lukas',
  'Sophie',
  'Maximilian',
  'Lena',
  'Felix',
  'Marie',
  'Jonas',
  'Laura',
  'Tobias',
  'Katharina',
  'Simon',
  'Julia',
  'Florian',
  'Theresa',
  'Andreas',
  'Magdalena',
  'Stefan',
  'Veronika',
  'Michael',
  'Franziska',
  'Johannes',
  'Lisa',
  'Sebastian',
  'Christina',
  'Benedikt',
  'Hannah',
  'Korbinian',
  'Elisabeth',
  'Quirin',
  'Rosa',
  'Vitus',
];

const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'StammPhoenixWebsite/1.0 (+https://stamm-phoenix.de; kontakt@stamm-phoenix.de)';
const NOMINATIM_INTERVAL_MS = 1100;
/** Radius around the base in which addresses are searched. */
const SEARCH_RADIUS_KM = 7;
const RANDOM_SEED = 6122026;

/** Postal code → town as written in addresses. */
const TOWNS: Record<string, string> = {
  '83620': 'Feldkirchen-Westerham',
  '83052': 'Bruckmühl',
};
/** Rough town centres, for bookings of which only the town could be located. */
const TOWN_CENTRES: Record<string, { lat: number; lon: number }> = {
  '83620': { lat: 47.9083, lon: 11.848 },
  '83052': { lat: 47.8795, lon: 11.9198 },
};

const SURNAMES = [
  'Huber',
  'Maier',
  'Gruber',
  'Brandl',
  'Wimmer',
  'Hofer',
  'Stadler',
  'Obermaier',
  'Kirchner',
  'Lechner',
  'Aigner',
  'Eder',
  'Pichler',
  'Moser',
  'Riedl',
  'Schmid',
  'Bauer',
  'Wagner',
  'Hölzl',
  'Rieder',
  'Kaiser',
  'Zehetmair',
  'Sedlmair',
  'Hintermaier',
  'Oberhauser',
  'Reiter',
  'Mayrhofer',
  'Staudinger',
  'Hartl',
  'Pfaffinger',
  'Loferer',
  'Weinberger',
  'Anzinger',
  'Holzner',
  'Kronast',
  'Mühlbauer',
  'Zellner',
  'Grasl',
  'Stangl',
  'Lindner',
  'Fuchs',
  'Ertl',
  'Dietl',
  'Wallner',
  'Kogler',
  'Steinberger',
  'Neumeier',
  'Friedl',
  'Baumgartner',
  'Seidl',
];

const HIDING_PLACES = [
  'In der Garage, rechts neben dem Fahrrad',
  'Hinter der Haustür im Blumenkasten',
  'Im Holzschuppen neben dem Eingang',
  'Unter der Gartenbank auf der Terrasse',
  'In der blauen Kiste vor der Kellertür',
  'Im Briefkasten-Häuschen am Gartentor',
  'Hinter dem großen Blumentopf links vom Eingang',
  'Auf dem Fensterbrett neben der Haustür',
  'Im Carport auf dem Regal',
  'In der Tasche an der Gartentür',
  'Neben der Mülltonne in der grünen Tüte',
  'Unter der Treppe zum Hauseingang',
];

const ADDRESS_NOTES = [
  'Bitte hinten über den Garten kommen',
  'Klingel „Familie“ im Erdgeschoss',
  'Einfahrt zwischen den beiden Garagen',
  'Hausnummer steht am Briefkasten, nicht am Haus',
  'Zweites Haus in der Einfahrt',
];

const NOTES = [
  'Unsere Tochter hat im Herbst das Radfahren ohne Stützräder gelernt.',
  'Bitte loben, dass der große Bruder so gut auf die Kleine aufpasst.',
  'Die Kinder sind etwas schüchtern, bitte ruhig angehen.',
  'Oma und Opa sind auch da.',
  'Unser Sohn hat Angst vor dem Krampus, bitte nicht zu wild.',
  'Bitte das Aufräumen im Kinderzimmer ansprechen.',
  'Die Zwillinge haben am 8. Dezember Geburtstag.',
];

interface Address {
  street: string;
  postalCode: string;
  city: string;
  lat: number | null;
  lon: number | null;
  precision: 'Adresse' | 'Straße' | 'Ort' | 'nicht gefunden';
}

/** Addresses that are not on the map, as happens with new streets. */
const UNLOCATED_ADDRESSES: Address[] = [
  {
    street: 'Am Neubaugebiet 3',
    postalCode: '83620',
    city: TOWNS['83620'],
    lat: null,
    lon: null,
    precision: 'nicht gefunden',
  },
  {
    street: 'Wiesenfeld 12a',
    postalCode: '83052',
    city: TOWNS['83052'],
    lat: null,
    lon: null,
    precision: 'nicht gefunden',
  },
];

interface NominatimReverse {
  lat?: string;
  lon?: string;
  address?: { road?: string; house_number?: string; postcode?: string };
}

/** Deterministic pseudo random numbers (mulberry32). */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: T[]): T {
  return items[Math.floor(random() * items.length)];
}

/** Fisher–Yates shuffle into a new array. */
function shuffle<T>(random: () => number, items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Loads `local.settings.json` into `process.env`, like the Functions runtime does. */
function loadLocalSettings(): void {
  const path = join(__dirname, '..', 'local.settings.json');
  let values: Record<string, string>;
  try {
    values =
      (JSON.parse(readFileSync(path, 'utf8')) as { Values?: Record<string, string> }).Values ?? {};
  } catch {
    throw new Error(`Could not read ${path}; copy local.settings.example.json and fill it in.`);
  }
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function reverseGeocode(lat: number, lon: number): Promise<NominatimReverse | null> {
  const params = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
  });
  const response = await fetch(`${NOMINATIM_REVERSE_URL}?${params.toString()}`, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  return (await response.json()) as NominatimReverse;
}

/** Finds `count` different real addresses in the service area around the base. */
async function findAddresses(
  count: number,
  base: { lat: number; lon: number },
  random: () => number
): Promise<Address[]> {
  const addresses: Address[] = [];
  const seen = new Set<string>();
  const maxAttempts = count * 6;

  for (let attempt = 0; attempt < maxAttempts && addresses.length < count; attempt++) {
    // Uniform point in a circle around the base
    const distance = SEARCH_RADIUS_KM * Math.sqrt(random());
    const angle = random() * 2 * Math.PI;
    const lat = base.lat + (distance / 111.32) * Math.cos(angle);
    const lon =
      base.lon + (distance / (111.32 * Math.cos((base.lat * Math.PI) / 180))) * Math.sin(angle);
    const fallbackNumber = String(1 + Math.floor(random() * 40));

    if (attempt > 0) await sleep(NOMINATIM_INTERVAL_MS);
    const result = await reverseGeocode(lat, lon).catch(() => null);
    const postalCode = result?.address?.postcode?.split(/[;,]/)[0]?.trim() ?? '';
    const road = result?.address?.road;
    if (!result?.lat || !result.lon || !road || !TOWNS[postalCode]) continue;

    const houseNumber = result.address?.house_number;
    const street = `${road} ${houseNumber ?? fallbackNumber}`;
    const key = `${street}|${postalCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push({
      street,
      postalCode,
      city: TOWNS[postalCode],
      lat: Number(result.lat),
      lon: Number(result.lon),
      precision: houseNumber ? 'Adresse' : 'Straße',
    });
    process.stdout.write(`\r  ${addresses.length}/${count} Adressen gefunden`);
  }
  process.stdout.write('\n');
  if (addresses.length < count) {
    throw new Error(`Only ${addresses.length} of ${count} addresses found, please run again.`);
  }
  return addresses;
}

function childrenCount(random: () => number): number {
  // Mostly 1–4 children, about one family in ten with 5–8 (an overlong visit)
  return random() < 0.1 ? 5 + Math.floor(random() * 4) : 1 + Math.floor(random() * 4);
}

function family(
  index: number,
  address: Address,
  random: () => number,
  surnames: string[]
): NikolausBookingDetails {
  const name = surnames[index];
  const local = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  return {
    familyName: name,
    email: `familie.${local}.${index + 1}@${TEST_EMAIL_DOMAIN}`,
    phone: `089 99998${String(Math.floor(random() * 1000)).padStart(3, '0')}`,
    street: address.street,
    postalCode: address.postalCode,
    city: address.city,
    addressNotes: random() < 0.2 ? pick(random, ADDRESS_NOTES) : '',
    childrenCount: childrenCount(random),
    withKrampus: random() < 0.35,
    hidingPlace: pick(random, HIDING_PLACES),
    notes: random() < 0.3 ? pick(random, NOTES) : '',
  };
}

function isTestBooking(booking: NikolausBooking): boolean {
  return booking.email.toLowerCase().endsWith(`@${TEST_EMAIL_DOMAIN}`);
}

async function deleteTestData(dryRun: boolean): Promise<void> {
  const bookings = (await getAllBookings()).filter(isTestBooking);
  const ids = new Set(bookings.map((b) => b.id));
  console.log(`${bookings.length} Testbuchungen gefunden.`);

  const dispoListId = process.env.SHAREPOINT_NIKOLAUS_DISPO_LIST_ID;
  const dispoRows = dispoListId
    ? (await getSharePointListItems(dispoListId, { expand: 'fields' })).filter((item) =>
        ids.has(String((item as { fields?: { Title?: string } }).fields?.Title ?? '').trim())
      )
    : [];
  if (dispoRows.length > 0) console.log(`${dispoRows.length} Dispo-Zeilen dazu gefunden.`);
  if (dryRun) return;

  const listId = getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_LIST_ID);
  for (const row of dispoRows) {
    await deleteSharePointListItem(dispoListId as string, String((row as { id: string }).id));
  }
  for (const booking of bookings) {
    await deleteSharePointListItem(listId, booking.id);
    console.log(`  gelöscht: ${booking.slotKey} Familie ${booking.familyName}`);
  }
}

/**
 * @param linksFile Receives `slotKey  family  /nikolaus/termin?token=…` per created booking; the
 *   tokens are stored only as hashes, so this is the only chance to open the families' view.
 */
async function createTestData(dryRun: boolean, linksFile: string | null): Promise<void> {
  const listId = getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_LIST_ID);
  const now = new Date();
  const bookings = await getAllBookings();
  const taken = new Map<string, number>();
  for (const booking of bookings) {
    if (isBlocking(booking, now)) taken.set(booking.slotKey, (taken.get(booking.slotKey) ?? 0) + 1);
  }
  // Past slots are filled as well, unlike in the public booking
  const places = getNikolausSlots().flatMap((slot) =>
    Array.from({ length: Math.max(0, slot.capacity - (taken.get(slot.key) ?? 0)) }, () => slot)
  );
  console.log(
    `${getNikolausSlots().length} Slots, ${bookings.filter((b) => isBlocking(b, now)).length} belegte Plätze, ${places.length} freie Plätze.`
  );
  if (places.length === 0) return;
  if (places.length > SURNAMES.length) {
    throw new Error(`Not enough surnames for ${places.length} bookings.`);
  }

  const random = createRandom(RANDOM_SEED);
  const surnames = shuffle(random, SURNAMES);

  // Two bookings without a location and one located only by town test the Dispo warnings
  const unlocated = places.length >= 6 ? 2 : 0;
  const townOnly = places.length >= 6 ? 1 : 0;
  console.log('Suche Adressen bei OpenStreetMap (etwa 1 Sekunde pro Anfrage) …');
  const found = await findAddresses(places.length - unlocated, NIKOLAUS_CONFIG.area.base, random);
  const addresses: Address[] = [...found, ...UNLOCATED_ADDRESSES].slice(0, places.length);
  for (let i = 0; i < townOnly; i++) {
    const address = addresses[i];
    const centre = TOWN_CENTRES[address.postalCode];
    addresses[i] = { ...address, lat: centre.lat, lon: centre.lon, precision: 'Ort' };
  }
  // Spread the special cases over the day instead of the first slots
  const order = shuffle(
    random,
    places.map((_, i) => i)
  );

  for (let i = 0; i < places.length; i++) {
    const slot = places[i];
    const address = addresses[order[i]];
    const details = family(i, address, random, surnames);
    const confirmedAt = new Date(now.getTime() - (1 + random() * 20) * 24 * 60 * 60_000);
    const linkSentAt = new Date(confirmedAt.getTime() - (2 + random() * 60) * 60_000);
    // About a quarter of the families have children in one of our groups
    const tags = random() < 0.25 ? [pick(random, GROUP_TAGS)] : [];
    const token = randomBytes(32).toString('base64url');
    const fields = {
      ...detailFields(details),
      InterneTags: tags.join(', '),
      Breitengrad: address.lat === null ? '' : address.lat.toFixed(6),
      Laengengrad: address.lon === null ? '' : address.lon.toFixed(6),
      GeoGenauigkeit: address.precision,
      Status: 'Bestaetigt',
      TokenHash: hashToken(token),
      SlotKey: slot.key,
      ...dateFields('Termin', slotKeyToDate(slot.key)),
      ...dateFields('BestaetigtAm', confirmedAt),
      ...dateFields('LinkGesendetAm', linkSentAt),
    };

    const line = `${slot.key}  ${details.familyName.padEnd(12)} ${String(details.childrenCount).padStart(2)} ${details.childrenCount === 1 ? 'Kind  ' : 'Kinder'}${details.withKrampus ? ' +K' : '   '}  ${details.street}, ${details.postalCode} ${details.city} (${address.precision})${tags.length ? ` [${tags.join(', ')}]` : ''}`;
    if (dryRun) {
      console.log(`  ${line}`);
      continue;
    }
    const id = await createSharePointListItem(listId, fields);
    console.log(`  #${id} ${line}`);
    if (linksFile) {
      appendFileSync(
        linksFile,
        `${slot.key}  ${details.familyName}  /nikolaus/termin?token=${token}\n`
      );
    }
  }
  if (dryRun) console.log('Probelauf: nichts angelegt.');
}

function isTestHelper(helper: Helper): boolean {
  return helper.notes.startsWith(TEST_HELPER_MARK);
}

/** Posts a test helper volunteers for on one day; drivers and Engerl are most common. */
function helperRoles(random: () => number): HelperRole[] {
  const chances: [HelperRole, number][] = [
    ['Nikolaus', 0.2],
    ['Krampus', 0.3],
    ['Fahrer*in', 0.45],
    ['Engerl', 0.4],
    ['Küche', 0.3],
  ];
  const roles = chances.filter(([, chance]) => random() < chance).map(([role]) => role);
  return roles.length > 0 ? roles : [pick(random, HELPER_ROLES)];
}

async function createTestHelpers(dryRun: boolean): Promise<void> {
  const existing = (await getHelpers()).filter(isTestHelper);
  if (existing.length > 0) {
    console.log(
      `Es gibt schon ${existing.length} Test-Helfende, erst --delete --helfende ausführen.`
    );
    return;
  }
  const random = createRandom(RANDOM_SEED + 1);
  const dates = [...NIKOLAUS_CONFIG.days].map((day) => day.date).sort();
  const firstNames = shuffle(random, FIRST_NAMES);
  const lastNames = shuffle(random, SURNAMES);

  for (let i = 0; i < TEST_HELPER_COUNT; i++) {
    const days = dates.filter(() => random() < 0.6);
    if (days.length === 0) days.push(pick(random, dates));
    const availability = Object.fromEntries(days.map((date) => [date, helperRoles(random)]));
    // Some leaders must not visit their own group, some would like to visit a group
    const negativeTags = random() < 0.35 ? [pick(random, GROUP_TAGS)] : [];
    const positiveTags =
      random() < 0.2
        ? [
            pick(
              random,
              GROUP_TAGS.filter((tag) => !negativeTags.includes(tag))
            ),
          ]
        : [];
    const input = {
      name: `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`,
      availability,
      positiveTags,
      negativeTags,
      notes: `${TEST_HELPER_MARK} Testdaten`,
    };
    const summary = Object.entries(availability)
      .map(([date, roles]) => `${date.slice(5)}: ${roles.join('/')}`)
      .join('  ');
    const tags = [...positiveTags.map((t) => `+${t}`), ...negativeTags.map((t) => `−${t}`)];
    const line = `${input.name.padEnd(22)} ${summary}${tags.length ? `  [${tags.join(', ')}]` : ''}`;
    if (dryRun) {
      console.log(`  ${line}`);
      continue;
    }
    const id = await createHelper(input);
    console.log(`  #${id} ${line}`);
  }
  if (dryRun) console.log('Probelauf: nichts angelegt.');
}

async function deleteTestHelpers(dryRun: boolean): Promise<void> {
  const helpers = (await getHelpers()).filter(isTestHelper);
  console.log(`${helpers.length} Test-Helfende gefunden.`);
  if (dryRun) return;
  for (const helper of helpers) {
    await deleteHelper(helper.id);
    await deleteEinteilungOfPerson(helper.id);
    console.log(`  gelöscht: ${helper.name}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const dryRun = args.has('--dry-run');
  const linksIndex = argv.indexOf('--links');
  const linksFile = linksIndex >= 0 ? (argv[linksIndex + 1] ?? null) : null;
  loadLocalSettings();
  if (args.has('--helfende')) {
    if (args.has('--delete')) await deleteTestHelpers(dryRun);
    else await createTestHelpers(dryRun);
  } else if (args.has('--delete')) await deleteTestData(dryRun);
  else await createTestData(dryRun, linksFile);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
