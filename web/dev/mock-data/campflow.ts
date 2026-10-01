/** CampFlow events and participants of the mock API (Leitendenbereich → Aktionen). */
import type {
  CampflowColumn,
  CampflowEvent,
  CampflowEventDetail,
  CampflowPerson,
} from '../../src/lib/types';
import { hashString } from './svg';
import { AKTION_DATES, dayFromToday, isoFromNow, plusDays } from './util';

const COLLECTIONS = {
  stamm: { id: 'col_stamm', name: 'Stammesaktionen' },
  woe: { id: 'col_woe', name: 'Wölflinge' },
  pfadi: { id: 'col_pfadi', name: 'Pfadfinder' },
  lager: { id: 'col_lager', name: 'Lager' },
};

function event(
  id: string,
  title: string,
  start: string | null,
  end: string | null,
  options: Partial<CampflowEvent> = {}
): CampflowEvent {
  return {
    id,
    title,
    published: true,
    start_date: start,
    end_date: end,
    max_persons: null,
    archived: false,
    url: `https://campflow.de/anmeldung/stamm-phoenix/${id.slice(4).toLowerCase()}`,
    collection: null,
    ...options,
  };
}

export const campflowEvents: CampflowEvent[] = [
  event(
    'evt_WoeHerbst',
    'Wölflings-Herbstwochenende',
    AKTION_DATES.woe,
    plusDays(AKTION_DATES.woe, 2),
    {
      max_persons: 30,
      collection: COLLECTIONS.woe,
    }
  ),
  event(
    'evt_HikeMangfall',
    'Hike durchs Mangfalltal',
    AKTION_DATES.hike,
    plusDays(AKTION_DATES.hike, 1),
    {
      max_persons: 24,
      collection: COLLECTIONS.pfadi,
    }
  ),
  event(
    'evt_PfadiWinter',
    'Pfadi-Winterlager auf der Hütte',
    AKTION_DATES.winter,
    plusDays(AKTION_DATES.winter, 3),
    {
      max_persons: 20,
      collection: COLLECTIONS.pfadi,
    }
  ),
  event('evt_Georgsfest', 'Georgsfest des Bezirks', AKTION_DATES.georg, AKTION_DATES.georg, {
    collection: COLLECTIONS.stamm,
  }),
  event(
    'evt_Pfingst27',
    'Pfingstlager 2027 am Chiemsee',
    AKTION_DATES.pfingst,
    plusDays(AKTION_DATES.pfingst, 6),
    {
      max_persons: 80,
      published: false,
      collection: COLLECTIONS.lager,
    }
  ),
  event(
    'evt_Sola26',
    'Sommerlager 2026 Oberjoch',
    AKTION_DATES.sola,
    plusDays(AKTION_DATES.sola, 10),
    {
      max_persons: 70,
      published: false,
      collection: COLLECTIONS.lager,
    }
  ),
  event('evt_Stavo', 'Stammesversammlung', AKTION_DATES.stavo, AKTION_DATES.stavo, {
    published: false,
    collection: COLLECTIONS.stamm,
  }),
  event('evt_Friedenslicht25', 'Friedenslicht 2025', '2025-12-14', '2025-12-14', {
    published: false,
    archived: true,
    collection: COLLECTIONS.stamm,
  }),
  event('evt_Elternabend', 'Elternabend (Termin folgt)', null, null, {
    published: false,
    url: null,
  }),
];

const COLUMNS: CampflowColumn[] = [
  {
    id: 'col_tshirt',
    name: 'T-Shirt-Größe',
    type: 'select',
    allowed_values: ['128', '140', '152', '164', 'S', 'M', 'L', 'XL'],
    external_id: 'tshirt',
  },
  {
    id: 'col_foto',
    name: 'Fotoerlaubnis',
    type: 'boolean',
    allowed_values: null,
    external_id: null,
  },
  {
    id: 'col_anreise',
    name: 'Anreise',
    type: 'select',
    allowed_values: ['Bus', 'Eltern bringen', 'Fahrgemeinschaft'],
    external_id: 'anreise',
  },
  { id: 'col_bemerkung', name: 'Bemerkung', type: 'text', allowed_values: null, external_id: null },
];

const FIRST_NAMES = [
  'Emma',
  'Leon',
  'Mia',
  'Paul',
  'Hannah',
  'Felix',
  'Lina',
  'Ben',
  'Marie',
  'Lukas',
  'Anna',
  'Jakob',
  'Sophia',
  'Elias',
  'Lea',
  'Noah',
  'Clara',
  'Moritz',
  'Johanna',
  'Vincent',
  'Magdalena',
  'Korbinian',
  'Theresa',
  'Xaver',
  'Franziska',
  'Valentin',
];
const LAST_NAMES = [
  'Huber',
  'Bauer',
  'Wagner',
  'Müller',
  'Mayr',
  'Schmid',
  'Hofmann',
  'Weber',
  'Berger',
  'Fischer',
  'Pichler',
  'Steiner',
  'Moser',
  'Leitner',
  'Holzner',
  'Aigner',
  'Brunner',
  'Lechner',
];
const STREETS = [
  'Ahornweg',
  'Birkenstraße',
  'Schulstraße',
  'Bergstraße',
  'Lindenweg',
  'Am Bahnhof',
];
const DIETS = ['meat', 'meat', 'meat', 'vegetarian', 'vegetarian', 'vegan'];

/** Small seeded PRNG (mulberry32), so every event gets stable but varied participants. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function personFor(eventId: string, index: number, start: string | null): CampflowPerson {
  const rnd = random(hashString(`${eventId}-${index}`));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);
  const age = 7 + Math.floor(rnd() * 12);
  const refYear = Number((start ?? dayFromToday(0)).slice(0, 4));
  const month = String(1 + Math.floor(rnd() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
  const cancelled = rnd() < 0.08;
  const confirmed = !cancelled && rnd() < 0.75;
  const inBruckmuehl = rnd() < 0.3;
  const diet = pick(DIETS);
  const person: CampflowPerson = {
    id: `prs_${eventId.slice(4)}${index}`,
    name: { first_name: first, last_name: last },
    gender: rnd() < 0.1 ? 'd' : pick(['f', 'm']),
    birthdate: `${refYear - age}-${month}-${day}`,
    primary_email: `${first.toLowerCase()}.${last.toLowerCase().replace('ü', 'ue')}@example.org`,
    phone_numbers: [
      {
        number: `0176 ${String(10000000 + Math.floor(rnd() * 89999999))}`,
        label: pick(['Mama', 'Papa', 'Mobil']),
      },
    ],
    address: {
      street: `${pick(STREETS)} ${1 + Math.floor(rnd() * 40)}`,
      zip: inBruckmuehl ? '83052' : '83620',
      city: inBruckmuehl ? 'Bruckmühl' : 'Feldkirchen-Westerham',
      country_code: 'DE',
    },
    diet: diet === 'meat' ? [] : [diet],
    intolerances: rnd() < 0.15 ? [pick(['Laktose', 'Gluten', 'Nüsse'])] : [],
    health: rnd() < 0.1 ? 'Heuschnupfen, Notfallspray im Rucksack' : '',
    swimming: rnd() > 0.15,
    group_names: [
      age < 10 ? 'Wölflinge' : age < 13 ? 'Jungpfadfinder' : age < 16 ? 'Pfadfinder' : 'Rover',
    ],
    creation_date: isoFromNow(-20 - rnd() * 30),
    confirmation_date: confirmed ? isoFromNow(-15 + rnd() * 5) : null,
    cancellation_date: cancelled ? isoFromNow(-3) : null,
    col_tshirt: pick(COLUMNS[0].allowed_values ?? ['M']),
    col_foto: rnd() > 0.15,
    col_anreise: pick(COLUMNS[2].allowed_values ?? ['Bus']),
    col_bemerkung:
      rnd() < 0.15
        ? 'Schläft gerne neben der Schwester im Zelt. Bitte bei Heimweh die Eltern anrufen, nicht die Großeltern.'
        : '',
  };
  return person;
}

export function campflowDetail(id: string): CampflowEventDetail | undefined {
  const evt = campflowEvents.find((e) => e.id === id);
  if (!evt) return undefined;
  const count = id === 'evt_Elternabend' ? 0 : 6 + (hashString(id) % 20);
  return {
    event: evt,
    columns: id === 'evt_Stavo' ? [] : COLUMNS,
    persons: Array.from({ length: count }, (_, i) => personFor(id, i, evt.start_date)),
  };
}
