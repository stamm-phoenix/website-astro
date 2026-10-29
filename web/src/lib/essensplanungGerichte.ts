import type { EssenKatalog, GerichtZutat, PlanungZutat } from './types';
import type { Vorschlag } from './vorschlaege';

/** Helpers of the area „Gerichte“ of a Planung (`docs/essensplanung.md`). */

/**
 * A typed amount like „1,5“, „200“ or „1.500“ (German thousands, as the recipe card shows them);
 * null for an empty field, NaN for anything else.
 */
export function leseMenge(text: string): number | null {
  const value = text.trim().replace(/\s/g, '');
  if (!value) return null;
  if (/^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(value))
    return Number(value.replace(/\./g, '').replace(',', '.'));
  // A point that cannot be thousands, e.g. 1.5, is a decimal point
  return /^\d+([.,]\d+)?$/.test(value) ? Number(value.replace(',', '.')) : Number.NaN;
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
export function zutatVorschlaege(
  katalog: EssenKatalog,
  zutaten: PlanungZutat[],
  /** Dishes take only food; stock and extra needs take dish soap too. */
  { nurLebensmittel = true }: { nurLebensmittel?: boolean } = {}
): Vorschlag[] {
  const kategorie = new Map(katalog.kategorien.map((k) => [k.id, k.name]));
  const genutzt = new Set(zutaten.map((z) => z.zutatId).filter((id) => id !== null));
  return [
    ...zutaten
      .filter((zutat) => zutat.lebensmittel || !nurLebensmittel)
      .map((zutat) => ({
        key: `p:${zutat.id}`,
        value: zutat.name,
        label: zutat.zutatId === null ? `${zutat.name} (eigene)` : zutat.name,
        gruppe: 'In dieser Planung',
        search: kategorie.get(zutat.kategorieId),
      })),
    ...katalog.zutaten
      .filter((zutat) => (zutat.lebensmittel || !nurLebensmittel) && !genutzt.has(zutat.id))
      .map((zutat) => ({
        key: `z:${zutat.id}`,
        value: zutat.name,
        gruppe: 'Zutatenliste',
        search: kategorie.get(zutat.kategorieId),
      })),
  ];
}

/** An ingredient chosen for a line: from the central list or of the Planung. */
export interface ZutatWahl {
  art: 'zentral' | 'planung';
  id: number;
}

/** The ingredient a suggestion of `zutatVorschlaege` stands for. */
export function zutatWahl(option: Vorschlag): ZutatWahl {
  const [art, id] = (option.key ?? '').split(':');
  return { art: art === 'p' ? 'planung' : 'zentral', id: Number(id) };
}

/** The suggestion whose name was typed, ignoring case but not umlauts (Ol is not Öl). */
export function getippteZutat(vorschlaege: Vorschlag[], text: string): Vorschlag | undefined {
  const name = text.trim();
  return vorschlaege.find(
    (option) => option.value.localeCompare(name, 'de', { sensitivity: 'accent' }) === 0
  );
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
