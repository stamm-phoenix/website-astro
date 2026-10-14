import type { WeiterePersonInput } from '../../../api/lib/pflege-validation';
import type { WeiterePerson } from '../../src/lib/types';

/** Altleitende and others of the mock API (#301), as kept in `organisation.person`. */

const LOGIN = 'leitung@example.test';
let nextId = 1;
let version = 1;

const etag = (): string => `"mock-person-${version++}"`;

function person(name: string, gruppe: WeiterePerson['gruppe'], aktiv = true): WeiterePerson {
  return {
    id: nextId++,
    name,
    login: '',
    gruppe,
    aktiv,
    etag: etag(),
    updatedAt: new Date().toISOString(),
    updatedBy: LOGIN,
  };
}

const personen: WeiterePerson[] = [
  person('Anna Altleiterin', 'altleitende'),
  person('Otto Ehemalig', 'altleitende'),
  person('Erika Elternbeirat', 'weitere'),
  person('Ingo Inaktiv', 'weitere', false),
];

export function weiterePersonen(): WeiterePerson[] {
  return [...personen].sort(
    (a, b) => Number(b.aktiv) - Number(a.aktiv) || a.name.localeCompare(b.name, 'de')
  );
}

export function addWeiterePerson(input: WeiterePersonInput): number {
  const created = { ...person(input.name, input.gruppe, input.aktiv), login: input.login };
  personen.push(created);
  return created.id;
}

/** `'conflict'` if the version is outdated, `false` if the person does not exist. */
export function updateWeiterePerson(
  id: number,
  input: WeiterePersonInput,
  version: string
): boolean | 'conflict' {
  const found = personen.find((p) => p.id === id);
  if (!found) return false;
  if (found.etag !== version) return 'conflict';
  Object.assign(found, input, {
    etag: etag(),
    updatedAt: new Date().toISOString(),
    updatedBy: LOGIN,
  });
  return true;
}

export function deleteWeiterePerson(id: number, version: string): boolean | 'conflict' {
  const index = personen.findIndex((p) => p.id === id);
  if (index < 0) return false;
  if (personen[index].etag !== version) return 'conflict';
  personen.splice(index, 1);
  return true;
}
