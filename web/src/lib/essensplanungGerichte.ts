import type { EssenKatalog, GerichtZutat, PlanungZutat } from './types';
import type { Vorschlag } from './vorschlaege';

/** Helpers of the area „Gerichte“ of a Planung (`docs/essensplanung.md`). */

/** A typed amount like „1,5“ or „200“; null for an empty field, NaN for anything else. */
export function leseMenge(text: string): number | null {
  const value = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!value) return null;
  return /^\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
}

/** An amount for an input field, „1,5“. */
export function mengeFeld(menge: number | null): string {
  return menge === null ? '' : String(menge).replace('.', ',');
}

/** The body that saves a line as it is, e.g. to move it. */
export function zeileBody(zeile: GerichtZutat) {
  return {
    etag: zeile.etag,
    planungZutatId: zeile.planungZutatId,
    menge: zeile.menge,
    einheit: zeile.einheit,
    fest: zeile.fest,
    fuerAlles: zeile.fuerAlles,
    fuerVegetarisch: zeile.fuerVegetarisch,
    fuerVegan: zeile.fuerVegan,
    ohne: zeile.ohne,
    nur: zeile.nur,
    hinweis: zeile.hinweis,
  };
}

/** Keys of the suggestions: `p:<id>` for ingredients of the Planung, `z:<id>` for the list. */
export function zutatVorschlaege(katalog: EssenKatalog, zutaten: PlanungZutat[]): Vorschlag[] {
  const kategorie = new Map(katalog.kategorien.map((k) => [k.id, k.name]));
  const genutzt = new Set(zutaten.map((z) => z.zutatId).filter((id) => id !== null));
  return [
    ...zutaten
      .filter((zutat) => zutat.lebensmittel)
      .map((zutat) => ({
        key: `p:${zutat.id}`,
        value: zutat.name,
        label: zutat.zutatId === null ? `${zutat.name} (eigene)` : zutat.name,
        gruppe: 'In dieser Planung',
        search: kategorie.get(zutat.kategorieId),
      })),
    ...katalog.zutaten
      .filter((zutat) => zutat.lebensmittel && !genutzt.has(zutat.id))
      .map((zutat) => ({
        key: `z:${zutat.id}`,
        value: zutat.name,
        gruppe: 'Zutatenliste',
        search: kategorie.get(zutat.kategorieId),
      })),
  ];
}

/** „vegan“, „vegetarisch“, „nicht vegetarisch“ or null while unknown. */
export function ernaehrung(zutat: Pick<PlanungZutat, 'vegetarisch' | 'vegan'>): string | null {
  if (zutat.vegan) return 'vegan';
  if (zutat.vegetarisch) return 'vegetarisch';
  if (zutat.vegetarisch === false) return 'nicht vegetarisch';
  return null;
}

/** For whom a line is, when not for everyone: „nur vegetarisch, vegan“. */
export function fuerText(zeile: GerichtZutat): string | null {
  if (zeile.fuerAlles && zeile.fuerVegetarisch && zeile.fuerVegan) return null;
  const formen = [
    zeile.fuerAlles ? 'mit allem' : '',
    zeile.fuerVegetarisch ? 'vegetarisch' : '',
    zeile.fuerVegan ? 'vegan' : '',
  ].filter(Boolean);
  return `nur ${formen.join(', ')}`;
}
