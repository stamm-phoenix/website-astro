import type { StatusTone } from './status';
import { brauchtAufmerksamkeit } from '../../../api/lib/inventur-model';
import type {
  InventarArtikel,
  InventarKategorie,
  InventarZustand,
} from '../../../api/lib/inventur-model';

export {
  INVENTAR_KATEGORIEN,
  INVENTAR_ZUSTAENDE,
  brauchtAufmerksamkeit,
} from '../../../api/lib/inventur-model';
export type {
  InventarArtikel,
  InventarKategorie,
  InventarVariante,
  InventarZustand,
} from '../../../api/lib/inventur-model';

export const KATEGORIE_LABELS: Record<InventarKategorie, string> = {
  kleidung: 'Kleidung',
  aufnaeher: 'Aufnäher',
  zelt: 'Zelte',
  lager: 'Lagermaterial',
};

/** What the variants of a category are called; categories without an entry have no variants. */
export const VARIANTEN_NAMEN: Partial<
  Record<InventarKategorie, { singular: string; hinzufuegen: string }>
> = {
  kleidung: { singular: 'Größe', hinzufuegen: 'Größe hinzufügen' },
  aufnaeher: { singular: 'Motiv', hinzufuegen: 'Motiv hinzufügen' },
};

export const ZUSTAND_LABELS: Record<InventarZustand, string> = {
  gut: 'In Ordnung',
  gebrauchsspuren: 'Gebrauchsspuren',
  reparatur: 'Reparatur nötig',
  defekt: 'Defekt',
};

export const ZUSTAND_TONES: Record<InventarZustand, StatusTone> = {
  gut: 'success',
  gebrauchsspuren: 'neutral',
  reparatur: 'warning',
  defekt: 'danger',
};

export interface InventarFilter {
  suche: string;
  kategorie: InventarKategorie | 'alle';
  lagerort: string;
  /** A condition, `fehlt` for articles with missing parts, or `alle`. */
  zustand: InventarZustand | 'fehlt' | 'alle';
}

export const KEIN_FILTER: InventarFilter = {
  suche: '',
  kategorie: 'alle',
  lagerort: '',
  zustand: 'alle',
};

/** The articles matching the search and all filters. */
export function filterInventar(
  artikel: InventarArtikel[],
  filter: InventarFilter
): InventarArtikel[] {
  const suche = filter.suche.trim().toLocaleLowerCase('de');
  return artikel.filter((a) => {
    if (filter.kategorie !== 'alle' && a.kategorie !== filter.kategorie) return false;
    if (filter.lagerort && a.lagerort !== filter.lagerort) return false;
    if (
      filter.zustand === 'fehlt'
        ? !a.fehlend
        : filter.zustand !== 'alle' && a.zustand !== filter.zustand
    )
      return false;
    if (!suche) return true;
    const text = [
      a.bezeichnung,
      a.lagerort,
      a.zubehoer,
      a.fehlend,
      a.notizen,
      ...a.varianten.map((v) => v.bezeichnung),
    ]
      .join(' ')
      .toLocaleLowerCase('de');
    return text.includes(suche);
  });
}

/** The storage places in use, for the filter and the suggestions. */
export function lagerorte(artikel: InventarArtikel[]): string[] {
  return [...new Set(artikel.map((a) => a.lagerort).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'de')
  );
}

/** Stock per size or motif, e.g. „S 4 · M 7“; empty for an article without named variants. */
export function variantenText(artikel: InventarArtikel): string {
  if (!artikel.varianten.some((v) => v.bezeichnung)) return '';
  return artikel.varianten.map((v) => `${v.bezeichnung || 'Ohne Angabe'} ${v.bestand}`).join(' · ');
}

/** „Anna Autorin“ from `anna.autorin@stamm-phoenix.de`. */
export function nameAusLogin(login: string): string {
  return login
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((teil) => teil.charAt(0).toLocaleUpperCase('de') + teil.slice(1))
    .join(' ');
}

/** The newest count of an article, or `null` if no variant was ever counted. */
export function letzteZaehlung(artikel: InventarArtikel): { am: string; von: string } | null {
  let neueste: { am: string; von: string } | null = null;
  for (const v of artikel.varianten) {
    if (v.gezaehltAm && (!neueste || v.gezaehltAm > neueste.am))
      neueste = { am: v.gezaehltAm, von: v.gezaehltVon ?? '' };
  }
  return neueste;
}

/** The number of articles that need repair or have missing parts. */
export function anzahlMitHandlungsbedarf(artikel: InventarArtikel[]): number {
  return artikel.filter(brauchtAufmerksamkeit).length;
}
