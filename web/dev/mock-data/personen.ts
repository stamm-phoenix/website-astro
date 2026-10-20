import type { CampflowMitglied, Ich, PersonInput } from '../../../api/lib/personen-model';
import type { Person, PersonenUebersicht } from '../../src/lib/types';

/**
 * The module „Personen“ of the mock API (`docs/personen.md`), as kept in `organisation.person`,
 * with the Entra group and the CampFlow member list it links.
 */

const LOGIN = 'leitung@example.test';
let nextId = 1;
let version = 1;

const etag = (): string => `"mock-person-${version++}"`;

/** The Entra group of the leaders, as in the person picker of the mock Protokoll-Editor. */
export const MOCK_LEITENDE = [
  { name: 'Demo Leitung', login: LOGIN },
  { name: 'Lea Leiterin', login: 'lea.leiterin@stamm-phoenix.de' },
  { name: 'Max Muster', login: 'max.muster@stamm-phoenix.de' },
  { name: 'Paula Protokoll', login: 'paula.protokoll@stamm-phoenix.de' },
  { name: 'Tom Test', login: 'tom.test@stamm-phoenix.de' },
  { name: 'Vera Vorstand', login: 'vera.vorstand@stamm-phoenix.de' },
];

const LEITER = '🐦‍🔥 Leiter*in';

function mitglied(
  id: string,
  firstName: string,
  lastName: string,
  groups: string[],
  ausgetreten = false
): CampflowMitglied {
  return { id, firstName, lastName, groups, ausgetreten };
}

/** The CampFlow member list: Lea has a suggestion, Max two persons with his name. */
const MITGLIEDER: CampflowMitglied[] = [
  mitglied('per_MockAnna', 'Anna', 'Altleiterin', ['Altleitende']),
  mitglied('per_MockDemo', 'Demo', 'Leitung', [LEITER]),
  mitglied('per_MockLea', 'Lea', 'Leiterin', [LEITER, '🟠 Wölfling']),
  mitglied('per_MockMax1', 'Max', 'Muster', [LEITER]),
  mitglied('per_MockMax2', 'Max', 'Muster', ['🟢 Pfadfinder*in']),
  mitglied('per_MockOtto', 'Otto', 'Ehemalig', [], true),
  mitglied('per_MockPaula', 'Paula', 'Protokoll', [LEITER]),
  mitglied('per_MockVera', 'Vera', 'Vorstand', [LEITER, 'Vorstand']),
].sort((a, b) => a.lastName.localeCompare(b.lastName, 'de'));

/** Primary address of the demo account in CampFlow; one registration of each event uses it. */
export const MOCK_ICH_EMAIL = 'demo.leitung@example.org';

function person(
  name: string,
  gruppe: Person['gruppe'],
  extra: Partial<Pick<Person, 'login' | 'campflowPersonId' | 'aktiv'>> = {}
): Person {
  return {
    id: nextId++,
    name,
    login: '',
    gruppe,
    campflowPersonId: '',
    aktiv: true,
    ...extra,
    etag: etag(),
    updatedAt: new Date().toISOString(),
    updatedBy: LOGIN,
  };
}

function initialPersonen(): Person[] {
  return [
    person('Demo Leitung', 'leitende', { login: LOGIN, campflowPersonId: 'per_MockDemo' }),
    person('Vera Vorstand', 'leitende', {
      login: 'vera.vorstand@stamm-phoenix.de',
      campflowPersonId: 'per_MockVera',
    }),
    person('Anna Altleiterin', 'altleitende', { campflowPersonId: 'per_MockAnna' }),
    person('Otto Ehemalig', 'altleitende'),
    person('Erika Elternbeirat', 'weitere'),
    person('Ingo Inaktiv', 'weitere', { aktiv: false }),
  ];
}

const personen: Person[] = initialPersonen();

/** Back to the demo list, for tests that link people. */
export function resetPersonen(): void {
  personen.splice(0, personen.length, ...initialPersonen());
}

export function mockPersonen(): Person[] {
  return [...personen].sort(
    (a, b) => Number(b.aktiv) - Number(a.aktiv) || a.name.localeCompare(b.name, 'de')
  );
}

export function personenUebersicht(): PersonenUebersicht {
  return { personen: mockPersonen(), leitende: MOCK_LEITENDE, campflow: MITGLIEDER };
}

/** Like the unique indexes of the table: a field error, or `undefined`. */
function taken(input: PersonInput, id?: number): Record<string, string> | undefined {
  const other = personen.find(
    (p) =>
      p.id !== id &&
      ((input.login && p.login === input.login) ||
        (input.campflowPersonId && p.campflowPersonId === input.campflowPersonId))
  );
  if (!other) return undefined;
  return other.campflowPersonId && other.campflowPersonId === input.campflowPersonId
    ? { campflowPersonId: `Diese CampFlow-Person ist schon mit ${other.name} verknüpft.` }
    : { login: `Dieses Microsoft-Konto steht schon bei ${other.name}.` };
}

export function addPerson(input: PersonInput): number | Record<string, string> {
  const conflict = taken(input);
  if (conflict) return conflict;
  const created = person(input.name, input.gruppe, input);
  personen.push(created);
  return created.id;
}

/** `'conflict'` if the version is outdated, `false` if the person does not exist. */
export function updatePerson(
  id: number,
  input: PersonInput,
  version: string
): boolean | 'conflict' | Record<string, string> {
  const found = personen.find((p) => p.id === id);
  if (!found) return false;
  if (found.etag !== version) return 'conflict';
  const conflict = taken(input, id);
  if (conflict) return conflict;
  Object.assign(found, input, {
    etag: etag(),
    updatedAt: new Date().toISOString(),
    updatedBy: LOGIN,
  });
  return true;
}

export function deletePerson(id: number, version: string): boolean | 'conflict' {
  const index = personen.findIndex((p) => p.id === id);
  if (index < 0) return false;
  if (personen[index].etag !== version) return 'conflict';
  personen.splice(index, 1);
  return true;
}

/** `GET /api/intern/ich` of the demo account. */
export function mockIch(login: string): Ich {
  const id = personen.find((p) => p.login === login)?.campflowPersonId;
  const linked = MITGLIEDER.find((m) => m.id === id);
  return {
    login,
    campflow: linked
      ? {
          id: linked.id,
          firstName: linked.firstName,
          lastName: linked.lastName,
          email: linked.id === 'per_MockDemo' ? MOCK_ICH_EMAIL : '',
        }
      : null,
  };
}
