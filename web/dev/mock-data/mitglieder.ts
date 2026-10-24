import type { CampflowColumn, CampflowPerson, MitgliederData } from '../../src/lib/types';
import { dayFromToday, isoFromNow } from './util';

/**
 * The CampFlow member list of the mock API (`/api/intern/mitglieder`): invented children of all
 * Stufen, Leitende (the demo account as `per_MockDemo`, like in the module „Personen“), someone
 * without a group, a former member and one who joins later.
 */

const COLUMNS: CampflowColumn[] = [
  {
    id: 'col_MockKonfession',
    name: 'Konfession',
    type: 'string',
    allowed_values: null,
    external_id: null,
  },
  {
    id: 'col_MockZeitschrift',
    name: 'Zeitschriftenversand',
    type: 'boolean',
    allowed_values: null,
    external_id: null,
  },
  {
    id: 'col_MockAusbildungen',
    name: 'Ausbildungen / Versprechen',
    type: 'array',
    allowed_values: null,
    external_id: null,
  },
];

const LEITER = '🐦‍🔥 Leiter*in';
const STUFEN: [group: string, age: number][] = [
  ['🟠 Wölfling', 8],
  ['🔵 Jungpfadfinder*in', 11],
  ['🟢 Pfadfinder*in', 14],
  ['🔴 Rover', 17],
];
const FIRST_NAMES = ['Emma', 'Leon', 'Mia', 'Paul', 'Lina', 'Felix', 'Clara', 'Xaver', 'Theresa'];
const LAST_NAMES = ['Huber', 'Bauer', 'Wagner', 'Mayr', 'Schmid', 'Berger', 'Pichler', 'Moser'];
const STREETS = ['Ahornweg', 'Birkenstraße', 'Schulstraße', 'Bergstraße', 'Lindenweg'];

let number = 1000;

function member(
  id: string,
  firstName: string,
  lastName: string,
  groups: string[],
  age: number,
  extra: Partial<CampflowPerson> = {}
): CampflowPerson {
  const index = number++;
  const birthYear = Number(dayFromToday(0).slice(0, 4)) - age;
  return {
    id,
    name: { first_name: firstName, last_name: lastName },
    title: null,
    gender: index % 3 === 0 ? 'f' : 'm',
    birthdate: `${birthYear}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
    primary_email: `${firstName}.${lastName}@example.org`.toLowerCase().replace('ü', 'ue'),
    cc_emails: [],
    phone_numbers: [{ number: `0176 ${10000000 + index * 7919}`, label: 'Mama' }],
    address: {
      postal_info: null,
      street: `${STREETS[index % STREETS.length]} ${(index % 40) + 1}`,
      postcode: index % 2 ? '83052' : '83620',
      city: index % 2 ? 'Bruckmühl' : 'Feldkirchen-Westerham',
      country_code: 'de',
      country_name: 'Deutschland',
    },
    membership_number: String(index),
    join_date: dayFromToday(-365 * Math.max(1, Math.min(age - 6, 6))),
    leave_date: null,
    annuity: 'Standardbeitrag',
    custom_annuity_amount: null,
    group_names: groups,
    label_names: [],
    creation_date: isoFromNow(-400),
    external_id: null,
    col_MockKonfession: index % 2 ? 'römisch-katholisch' : 'evangelisch',
    col_MockZeitschrift: index % 4 !== 0,
    col_MockAusbildungen: [],
    ...extra,
  };
}

function children(): CampflowPerson[] {
  return STUFEN.flatMap(([group, age], stufe) =>
    Array.from({ length: 5 - stufe }, (_, i) =>
      member(
        `per_MockKind${stufe}${i}`,
        FIRST_NAMES[(stufe * 3 + i) % FIRST_NAMES.length],
        LAST_NAMES[(stufe * 5 + i * 3) % LAST_NAMES.length],
        [group],
        age + (i % 2)
      )
    )
  );
}

function initialMitglieder(): CampflowPerson[] {
  return [
    ...children(),
    member('per_MockDemo', 'Demo', 'Leitung', [LEITER], 28, {
      primary_email: 'demo.leitung@example.org',
      col_MockAusbildungen: ['Woodbadge', 'Versprechen Rover'],
    }),
    member('per_MockLea', 'Lea', 'Leiterin', [LEITER, '🟠 Wölfling'], 24),
    member('per_MockVera', 'Vera', 'Vorstand', [LEITER, 'Vorstand'], 45, {
      custom_annuity_amount: 4000,
      annuity: null,
    }),
    member('per_MockAnna', 'Anna', 'Altleiterin', ['⚜️ Ehemalige*r'], 52),
    member('per_MockOhne', 'Olli', 'Ohnegruppe', [], 30),
    member('per_MockOtto', 'Otto', 'Ehemalig', ['🔴 Rover'], 21, {
      leave_date: dayFromToday(-90),
    }),
    member('per_MockNeu', 'Nina', 'Neu', ['🟠 Wölfling'], 7, {
      join_date: dayFromToday(14),
    }),
  ];
}

export function mitgliederData(): MitgliederData {
  number = 1000;
  return { loadedAt: new Date().toISOString(), columns: COLUMNS, persons: initialMitglieder() };
}
