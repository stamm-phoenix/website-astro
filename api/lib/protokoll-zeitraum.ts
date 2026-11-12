import type { ProtokollZeitraum } from './protokoll-editor-model';

/** „12.–14.06.2026“, „03.10.2026“ or empty: the dates of an Aktion or item below the title. */
export function aktionZeitraum(aktion: ProtokollZeitraum): string {
  const format = (date: string): string[] => {
    const [year, month, day] = date.split('-');
    return [day, month, year];
  };
  // A range typed the wrong way round reads as the range it means
  const [start, ende] =
    aktion.start && aktion.ende && aktion.ende < aktion.start
      ? [aktion.ende, aktion.start]
      : [aktion.start || aktion.ende, aktion.ende];
  if (!start) return '';
  const [d1, m1, y1] = format(start);
  if (!ende || ende === start) return `${d1}.${m1}.${y1}`;
  const [d2, m2, y2] = format(ende);
  if (y1 !== y2) return `${d1}.${m1}.${y1}–${d2}.${m2}.${y2}`;
  if (m1 !== m2) return `${d1}.${m1}.–${d2}.${m2}.${y2}`;
  return `${d1}.–${d2}.${m2}.${y2}`;
}
