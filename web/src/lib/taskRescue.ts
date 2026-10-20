import type { TaskPerson } from '../../../api/lib/aufgaben-model';
import type { RescueField } from './geretteteEingaben';

function peopleFrom(value: string): TaskPerson[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 20) return null;
    const people: TaskPerson[] = [];
    for (const person of parsed) {
      if (typeof person !== 'object' || person === null) return null;
      const { name, login } = person as Record<string, unknown>;
      if (typeof name !== 'string' || typeof login !== 'string') return null;
      people.push({ name, login });
    }
    return people;
  } catch {
    return null;
  }
}

/** Keeps selected identities rather than the already-cleared person search field. */
export function rescuePeople(
  label: string,
  get: () => TaskPerson[] | undefined,
  set: (people: TaskPerson[]) => void
): RescueField {
  return {
    key: `${label}#custom`,
    get: () => JSON.stringify(get() ?? []),
    describe: (value) =>
      (peopleFrom(value) ?? [])
        .map((person) => (person.login ? `${person.name} (${person.login})` : person.name))
        .join(', '),
    set(value) {
      const people = peopleFrom(value);
      if (!people) return false;
      set(people);
      return true;
    },
  };
}
