/** Shared Verleih contracts; browser-safe and independent of validation/database code. */
export const VERLEIH_STATUS = [
  'antrag',
  'genehmigt',
  'ausgegeben',
  'abgeschlossen',
  'abgelehnt',
  'zurueckgezogen',
] as const;
export type VerleihStatus = (typeof VERLEIH_STATUS)[number];
export interface VerleihPositionInput {
  varianteId: number;
  menge: number;
}
export interface VerleihInput {
  entleiher: string;
  kontakt: string;
  verantwortlich: string;
  von: string;
  bis: string;
  notizen: string;
  positionen: VerleihPositionInput[];
}
export interface VerleihPosition extends VerleihPositionInput {
  id: number;
  artikelId: number;
  bezeichnung: string;
  zurueck: number;
}
export interface VerleihVorgang extends Omit<VerleihInput, 'positionen'> {
  id: number;
  etag: string;
  status: VerleihStatus;
  eingetragenVon: string;
  positionen: VerleihPosition[];
  verlauf: { am: string; von: string; text: string }[];
  mailOffen: number;
}
export interface VerleihUebersicht {
  vorgaenge: VerleihVorgang[];
  materialwart: string;
  darfEinrichten: boolean;
  login: string;
}
export interface Reservierung {
  von: string;
  bis: string;
  menge: number;
  ueberfaellig?: boolean;
}
/** Maximum simultaneous reservation, with inclusive dates and overdue material still blocked. */
export function reservierterBestand(
  reservierungen: Reservierung[],
  von: string,
  bis: string
): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis) || von > bis) return 0;
  const events = new Map<number, number>();
  for (const r of reservierungen) {
    const start = r.von > von ? r.von : von;
    const end = r.ueberfaellig || r.bis > bis ? bis : r.bis;
    if (start > end || r.menge <= 0) continue;
    const first = Date.parse(`${start}T00:00:00Z`);
    const key = Date.parse(`${end}T00:00:00Z`) + 86_400_000;
    events.set(first, (events.get(first) ?? 0) + r.menge);
    events.set(key, (events.get(key) ?? 0) - r.menge);
  }
  let current = 0,
    maximum = 0;
  for (const [, change] of [...events].sort(([a], [b]) => a - b)) {
    current += change;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}
