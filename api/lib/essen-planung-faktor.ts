/** The factor of a dish at a meal: its amounts times this (0,5 when only half eat the dessert). */
export const MAX_FAKTOR = 20;

export const FAKTOR_FEHLER = `Bitte eine Zahl von 0,001 bis ${MAX_FAKTOR} eintragen, z. B. 0,5.`;

/** A factor as stored: from 0.001 to `MAX_FAKTOR`, three decimals at most (`decimal(6, 3)`). */
export function faktorGueltig(faktor: number): boolean {
  return (
    faktor >= 0.001 &&
    faktor <= MAX_FAKTOR &&
    Math.abs(Math.round(faktor * 1000) - faktor * 1000) < 1e-6
  );
}

/** The factor as typed („0,5“) or sent (0.5); NaN for anything else. */
export function leseFaktor(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const text = value.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}
