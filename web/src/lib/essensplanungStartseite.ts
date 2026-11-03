import type { LeitungPlanung } from '../../../api/lib/essen-leitung-model';

/**
 * The Planungen for the card „Essensplanung“ on the start page of the Leitendenbereich:
 * invitations not opened yet first, then those that are running or still to come, the nearest
 * first; Planungen without days count as still to come. Past ones stay on „Meine Planungen“.
 */
export function planungenFuerStartseite(
  planungen: readonly LeitungPlanung[],
  heute: string
): LeitungPlanung[] {
  const anstehend = planungen.filter(
    (planung) => planung.neu || planung.letzterTag === null || planung.letzterTag >= heute
  );
  return anstehend.sort(
    (a, b) =>
      Number(b.neu) - Number(a.neu) ||
      (a.ersterTag ?? '0000').localeCompare(b.ersterTag ?? '0000') ||
      a.name.localeCompare(b.name, 'de')
  );
}
