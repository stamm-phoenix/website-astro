import { FAHRTEN } from './fahrtenPlan';
import type { Fahrt, FahrtPerson, FahrtPlan } from './fahrtenPlan';
import type { FahrtenMailInput } from '../../../api/lib/validation/fahrten';

/** A driver of the plan, with the directions they drive. */
export interface MailFahrer {
  person: FahrtPerson;
  fahrten: Fahrt[];
}

/** Everyone who drives on Hin- or Rückfahrt, in the order of the cars. */
export function mailFahrer(plans: Record<Fahrt, FahrtPlan>): MailFahrer[] {
  const fahrer = new Map<string, MailFahrer>();
  for (const fahrt of FAHRTEN) {
    for (const auto of plans[fahrt].autos) {
      const entry = fahrer.get(auto.fahrer.id) ?? { person: auto.fahrer, fahrten: [] };
      entry.fahrten.push(fahrt);
      fahrer.set(auto.fahrer.id, entry);
    }
  }
  return [...fahrer.values()];
}

/** The request that mails each driver their passengers; only person ids leave the browser. */
export function fahrtenMailBody(
  plans: Record<Fahrt, FahrtPlan>,
  nachricht: string
): FahrtenMailInput {
  const cars = (fahrt: Fahrt): FahrtenMailInput['fahrten'][Fahrt] =>
    plans[fahrt].autos.map((auto) => ({
      fahrer: auto.fahrer.id,
      mitfahrende: auto.mitfahrende.map((person) => person.id),
    }));
  return { fahrten: { hin: cars('hin'), rueck: cars('rueck') }, nachricht: nachricht.trim() };
}

/** Joins names as „A, B und C“. */
export function namensListe(namen: string[]): string {
  if (namen.length <= 1) return namen.join('');
  return `${namen.slice(0, -1).join(', ')} und ${namen.at(-1)}`;
}
