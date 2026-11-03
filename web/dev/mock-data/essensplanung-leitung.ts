import type { LeitungPlanung } from '../../../api/lib/essen-leitung-model';
import { planungen } from './essensplanung-planung';

/**
 * The Planungen of the mock login for „Meine Essensplanungen“ (`api/lib/essen-leitung.ts`). The
 * mock API has no table for the tokens of the Leitendenbereich, it hands out the member's own
 * token, and it skips the check for an address of the Stamm (its login is `@example.test`).
 */
export function leitungPlanungen(email: string): LeitungPlanung[] {
  const adresse = email.toLowerCase();
  const liste: LeitungPlanung[] = [];
  for (const planung of planungen) {
    const mitglied = planung.mitglieder
      .filter((m) => m.email === adresse && !m.entzogen && m.token)
      .sort(
        (a, b) => Number(b.rolle === 'besitzer') - Number(a.rolle === 'besitzer') || a.id - b.id
      )[0];
    if (!mitglied?.token) continue;
    const daten = planung.tage.map((t) => t.datum).sort();
    liste.push({
      planungId: planung.id,
      name: planung.name,
      rolle: mitglied.rolle,
      ersterTag: daten[0] ?? null,
      letzterTag: daten.at(-1) ?? null,
      token: mitglied.token,
    });
  }
  return liste.sort(
    (a, b) =>
      (b.ersterTag ?? '9999').localeCompare(a.ersterTag ?? '9999') ||
      a.name.localeCompare(b.name, 'de')
  );
}
