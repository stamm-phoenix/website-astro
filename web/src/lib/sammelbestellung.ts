export {
  SAMMEL_STATUS,
  isSammelOpen,
  canEditSammelOrder,
} from '../../../api/lib/sammelbestellung-model';

import { dateToLocalParts, localDateTimeToDate } from '../../../api/lib/nikolaus-config';

/** Interpret leader-entered dates in Europe/Berlin, independent of the browser timezone. */
export function sammelInstant(value: string): string {
  const [date, time] = value.split('T');
  if (!date || !time) throw new Error('Bitte gib einen gültigen Zeitpunkt ein.');
  const result = localDateTimeToDate(date, time);
  const parts = dateToLocalParts(result);
  if (parts.date !== date || parts.time !== time)
    throw new Error(
      'Dieser Zeitpunkt existiert in Europe/Berlin nicht. Bitte prüfe Datum und Uhrzeit.'
    );
  return result.toISOString();
}
