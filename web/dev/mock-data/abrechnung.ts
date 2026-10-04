/** Einzelnachweise and Kostenstellen of the mock API (Leitendenbereich → Abrechnung). */
import { countPersons, summarizeEntries } from '../../../api/lib/abrechnung';
import type { Buchung } from '../../../api/lib/abrechnung';
import type { Abrechnung, CampflowPerson, Kostenstelle } from '../../src/lib/types';
import { campflowDetail } from './campflow';

export const kostenstellen: Kostenstelle[] = [
  { id: 'cun_Sola26', name: 'Sommerlager 2026 Oberjoch', archived: false },
  { id: 'cun_WoeHerbst', name: 'Wölflings-Herbstwochenende', archived: false },
  { id: 'cun_Hike', name: 'Hike 2026', archived: false },
  { id: 'cun_Stavo', name: 'Stammesversammlung', archived: false },
  { id: 'cun_Allgemein', name: 'Allgemein', archived: false },
  { id: 'cun_Sola25', name: 'Sommerlager 2025', archived: true },
];

type Eintrag = [category: string, amountEur: number];

const BUCHUNGEN: Record<string, Eintrag[]> = {
  // Deficit like the template Abrechnungsmappe: the KJR grant covers part of it
  cun_Sola26: [
    ['Teilnehmerbeiträge', 1850],
    ['Teilnehmerbeiträge', 1650],
    ['Teilnehmerbeiträge', 1400],
    ['Unterkunft', -400],
    ['Unterkunft', -2750.4],
    ['Transport', -1335.06],
    ['Transport', -620],
    ['Verpflegung', -983.37],
    ['Verpflegung', -1112.15],
    ['Verpflegung', -389.9],
    ['Material', -149.45],
    ['Programm', -310],
  ],
  // Surplus: no grant can be applied for
  cun_WoeHerbst: [
    ['Teilnehmerbeiträge', 1260],
    ['Unterkunft', -480],
    ['Verpflegung', -312.48],
    ['Material', -36.9],
  ],
  cun_Hike: [
    ['Teilnehmerbeiträge', 240],
    ['Transport', -186.4],
    ['Verpflegung', -95.2],
  ],
  // Single day without overnight stay: 5 € per person
  cun_Stavo: [
    ['Verpflegung', -64.5],
    ['Spenden', 20],
  ],
};

/** Leaders who register as participants; the KJR counts them as Betreuer*innen from 27 on. */
const BETREUENDE: Record<string, number> = { evt_Sola26: 3, evt_WoeHerbst: 1, evt_Stavo: 2 };

function entries(costUnit: Kostenstelle): Buchung[] {
  return (BUCHUNGEN[costUnit.id] ?? []).map(([category, amountEur]) => ({ category, amountEur }));
}

function findKostenstelle(wanted: string): Kostenstelle | undefined {
  const name = wanted.trim().toLowerCase();
  return kostenstellen.find((k) => k.id === wanted || k.name.toLowerCase() === name);
}

/** Like `GET /api/intern/abrechnung/{id}`; a string is the error code. */
export function abrechnungFor(
  id: string,
  requested: string
): Abrechnung | 'NOT_FOUND' | 'KOSTENSTELLE_NOT_FOUND' {
  const detail = campflowDetail(id);
  if (!detail) return 'NOT_FOUND';
  const costUnit = findKostenstelle(requested || detail.event.title);
  if (!costUnit) return 'KOSTENSTELLE_NOT_FOUND';

  const start = detail.event.start_date ?? '2026-01-01';
  const leaders: CampflowPerson[] = Array.from({ length: BETREUENDE[id] ?? 0 }, (_, i) => ({
    id: `prs_leitung${i}`,
    birthdate: `${Number(start.slice(0, 4)) - 28 - i * 5}-01-15`,
    confirmation_date: '2026-01-01T10:00:00Z',
  }));

  return {
    event: {
      id: detail.event.id,
      title: detail.event.title,
      start_date: detail.event.start_date,
      end_date: detail.event.end_date,
    },
    costUnit: { id: costUnit.id, name: costUnit.name },
    persons: countPersons([...detail.persons, ...leaders], detail.event.start_date),
    bilanz: summarizeEntries(entries(costUnit)),
  };
}
