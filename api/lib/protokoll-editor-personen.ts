import type {
  PersonOption,
  ProtokollEditorPersonen,
  ProtokollPerson,
} from './protokoll-editor-model';
import { PERSON_GRUPPEN } from './protokoll-editor-model';
import { getPersonen } from './personen';
import { getTaskDirectoryUsers } from './task-directory';

/**
 * The people to pick in the minutes: the leaders from the Entra group and the active Altleitende
 * and others of the list (#301). A source that fails is left out and reported as
 * `unavailable`; names can always be typed. The same people can be mentioned with `@` (#547).
 */
export async function loadEditorPersonen(): Promise<ProtokollEditorPersonen> {
  const [leitende, weitere] = await Promise.allSettled([getTaskDirectoryUsers(), getPersonen()]);
  const personen = new Map<string, PersonOption>();
  const key = (person: ProtokollPerson): string =>
    person.login ? person.login.toLowerCase() : `name:${person.name.toLowerCase()}`;
  if (leitende.status === 'fulfilled') {
    for (const user of leitende.value) {
      const person: PersonOption = { login: user.login, name: user.name, gruppe: 'leitende' };
      if (!personen.has(key(person))) personen.set(key(person), person);
    }
  }
  if (weitere.status === 'fulfilled') {
    // Rows of leaders only link them to CampFlow; the Entra group says who leads
    for (const entry of weitere.value.filter((p) => p.aktiv && p.gruppe !== 'leitende')) {
      const person: PersonOption = { login: entry.login, name: entry.name, gruppe: entry.gruppe };
      // Someone in the Entra group counts as a leader, even if also on the list
      if (!personen.has(key(person))) personen.set(key(person), person);
    }
  }
  return {
    personen: [...personen.values()].sort(
      (a, b) =>
        PERSON_GRUPPEN.indexOf(a.gruppe) - PERSON_GRUPPEN.indexOf(b.gruppe) ||
        a.name.localeCompare(b.name, 'de')
    ),
    unavailable: leitende.status === 'rejected' || weitere.status === 'rejected',
  };
}
