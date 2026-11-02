/**
 * What is typed into the rows of the receipts and not saved yet, by receipt ID. `PlanBelege.svelte`
 * holds it, so a filter that hides a row or the maintenance mode keeps it, and leaving the page
 * asks while one is open.
 */

export type BelegFeld = 'datum' | 'haendler' | 'notiz' | 'betrag';

export interface BelegZeilenEntwurf {
  /** Typed values by field. */
  felder: Partial<Record<BelegFeld, string>>;
  /** The version of the receipt when typing began; null: the one shown. */
  basis: string | null;
  /** Messages per field, e.g. of a failed save. */
  fehler: Partial<Record<BelegFeld | 'bezahlt', string>>;
  /** A free name for „Bezahlt von“ being typed; null while none. */
  name: string | null;
}

export type BelegEntwuerfe = Record<number, BelegZeilenEntwurf>;

export function neuerEntwurf(): BelegZeilenEntwurf {
  return { felder: {}, basis: null, fehler: {}, name: null };
}

/** Whether a draft holds input that is not saved. */
export function entwurfOffen(entwurf: BelegZeilenEntwurf | undefined): boolean {
  return !!entwurf && (Object.keys(entwurf.felder).length > 0 || entwurf.name !== null);
}

/** Whether a draft can go: nothing typed and no message left. */
export function entwurfLeer(entwurf: BelegZeilenEntwurf): boolean {
  return !entwurfOffen(entwurf) && Object.keys(entwurf.fehler).length === 0;
}

/** „Händler: Rewe, Betrag: 12,30“ – what was typed, to copy after the receipt went. */
export function entwurfText(entwurf: BelegZeilenEntwurf): string {
  const namen: Record<BelegFeld, string> = {
    datum: 'Datum',
    haendler: 'Händler',
    betrag: 'Betrag',
    notiz: 'Notiz',
  };
  const teile = (Object.keys(entwurf.felder) as BelegFeld[]).map(
    (feld) => `${namen[feld]}: ${entwurf.felder[feld]}`
  );
  if (entwurf.name !== null) teile.push(`Bezahlt von: ${entwurf.name}`);
  return teile.join(', ');
}
