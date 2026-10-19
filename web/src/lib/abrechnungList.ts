import { isAktion } from './aktionArt';
import { kjrFristStand } from './kjrFristen';
import type { CampflowEvent } from './types';

interface AbrechnungGroup {
  id: string;
  title: string;
  events: CampflowEvent[];
}
/**
 * Put ended Aktionen with an open deadline before upcoming camps, without hiding older ones.
 * Events that are no real Aktion (e.g. orders of jumpers) come last in a group of their own.
 */
export function abrechnungGroups(
  events: CampflowEvent[],
  today: string,
  archived: boolean
): AbrechnungGroup[] {
  const groups: AbrechnungGroup[] = archived
    ? [{ id: 'archiv', title: 'Archivierte Aktionen', events: [] }]
    : [
        { id: 'jetzt', title: 'Jetzt abrechnen', events: [] },
        { id: 'laufend', title: 'Laufende Aktionen', events: [] },
        { id: 'geplant', title: 'Geplant', events: [] },
        { id: 'weitere', title: 'Weitere Aktionen', events: [] },
        { id: 'sonstiges', title: 'Bestellungen und Sonstiges', events: [] },
      ];
  for (const event of events) {
    const stand = kjrFristStand(event, today);
    const start = event.start_date?.slice(0, 10);
    const end = (event.end_date ?? event.start_date)?.slice(0, 10);
    const id = archived
      ? 'archiv'
      : !isAktion(event)
        ? 'sonstiges'
        : stand?.vorbei && (!event.zuschussfaehig || stand.tage >= 0)
          ? 'jetzt'
          : start && end && start <= today && end >= today
            ? 'laufend'
            : start && start > today
              ? 'geplant'
              : 'weitere';
    groups.find((group) => group.id === id)!.events.push(event);
  }
  for (const group of groups) {
    group.events.sort((a, b) => {
      const first =
        group.id === 'jetzt'
          ? ((a.zuschussfaehig ? kjrFristStand(a, today)?.frist : a.end_date) ?? '')
          : (a.start_date ?? '');
      const second =
        group.id === 'jetzt'
          ? ((b.zuschussfaehig ? kjrFristStand(b, today)?.frist : b.end_date) ?? '')
          : (b.start_date ?? '');
      return (
        (group.id === 'archiv' || group.id === 'weitere'
          ? second.localeCompare(first)
          : first.localeCompare(second)) || a.title.localeCompare(b.title, 'de')
      );
    });
  }
  return groups.filter((group) => group.events.length > 0);
}
