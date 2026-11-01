import { datumKurz } from '../../lib/essensplanung';
import type { Einkauf } from '../../../../api/lib/essen-einkaeufe-model';
import type { PlanungAnsicht } from '../../lib/types';

/** What a trip covers: „Sa., 31.7.2027 · Metro · bis 2_1 Frühstück“. */
export function einkaufInfo(
  ansicht: Pick<PlanungAnsicht, 'geschaefte' | 'tage'>,
  einkauf: Pick<Einkauf, 'datum' | 'geschaeftId' | 'bisMahlzeitId'>
): string {
  const geschaeft = ansicht.geschaefte.find((g) => g.id === einkauf.geschaeftId)?.name;
  const mahlzeit = ansicht.tage
    .flatMap((t) => t.mahlzeiten)
    .find((m) => m.id === einkauf.bisMahlzeitId);
  return [
    einkauf.datum ? datumKurz(einkauf.datum) : '',
    geschaeft ?? 'alle Geschäfte',
    mahlzeit ? `bis ${mahlzeit.kennung} ${mahlzeit.name}` : 'alle Mahlzeiten',
  ]
    .filter(Boolean)
    .join(' · ');
}
