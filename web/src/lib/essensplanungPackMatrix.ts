import { freiName, type PackZeile } from './essensplanungPackliste';
import type { PlanungMitglied } from './types';

/**
 * The packing list as a matrix (`docs/essensplanung.md`, Packliste): who packs it across, the
 * things down. A column is a member, a free name some row has, or nobody.
 */

/** One person of the matrix. */
export interface PackSpalte {
  /** `m:<id>` for a member, `t:<name>` for a free name, `niemand`. */
  key: string;
  name: string;
  /** What a click in the column saves as who packs it. */
  zustaendigId: number | null;
  zustaendigText: string;
  ich: boolean;
  /**
   * A member without access: removed, or missing from the view (those who do not manage the
   * members do not get removed ones). They keep what they pack, but get nothing new.
   */
  ohneZugang: boolean;
}

export const NIEMAND = 'niemand';

const VERGLEICH = new Intl.Collator('de');

/** The column of who packs a row. */
export function spalteVon(zeile: Pick<PackZeile, 'zustaendigId' | 'zustaendig'>): string {
  if (zeile.zustaendigId !== null) return `m:${zeile.zustaendigId}`;
  const text = freiName(zeile.zustaendig);
  return text ? `t:${text}` : NIEMAND;
}

/**
 * The columns: the members with access in the order of the view (one without access only while
 * they pack something), then the free names of the rows by name, then nobody.
 */
export function packSpalten(
  mitglieder: Pick<PlanungMitglied, 'id' | 'name' | 'entzogen' | 'ich'>[],
  zeilen: Pick<PackZeile, 'zustaendigId' | 'zustaendig'>[]
): PackSpalte[] {
  const spalten: PackSpalte[] = mitglieder
    .filter((m) => !m.entzogen || zeilen.some((z) => z.zustaendigId === m.id))
    .map((m) => ({
      key: `m:${m.id}`,
      name: m.name,
      zustaendigId: m.id,
      zustaendigText: '',
      ich: m.ich,
      ohneZugang: m.entzogen,
    }));
  const da = new Set(spalten.map((s) => s.key));
  const frei = new Map<string, PackSpalte>();
  for (const zeile of zeilen) {
    const key = spalteVon(zeile);
    if (key === NIEMAND || da.has(key)) continue;
    if (zeile.zustaendigId !== null) {
      // A member the view lacks, e.g. one without access for those who only read
      da.add(key);
      spalten.push({
        key,
        name: zeile.zustaendig || 'Mitglied ohne Zugang',
        zustaendigId: zeile.zustaendigId,
        zustaendigText: '',
        ich: false,
        ohneZugang: true,
      });
    } else if (!frei.has(key)) {
      const name = freiName(zeile.zustaendig);
      frei.set(key, {
        key,
        name,
        zustaendigId: null,
        zustaendigText: name,
        ich: false,
        ohneZugang: false,
      });
    }
  }
  return [
    ...spalten,
    ...[...frei.values()].sort((a, b) => VERGLEICH.compare(a.name, b.name)),
    {
      key: NIEMAND,
      name: 'Niemand',
      zustaendigId: null,
      zustaendigText: '',
      ich: false,
      ohneZugang: false,
    },
  ];
}

/** How many things a column packs and how many of them are packed. */
export function spaltenSumme(
  zeilen: Pick<PackZeile, 'zustaendigId' | 'zustaendig' | 'gepackt'>[],
  key: string
): { gepackt: number; gesamt: number } {
  const eigene = zeilen.filter((zeile) => spalteVon(zeile) === key);
  return { gepackt: eigene.filter((zeile) => zeile.gepackt).length, gesamt: eigene.length };
}

/** A cell of the matrix: row index, column index (0 is „gepackt“, then the persons). */
export interface PackZelle {
  zeile: number;
  spalte: number;
}

/**
 * The cell a key moves the focus to, like in a spreadsheet: arrows, Home/End in the row,
 * Ctrl+Home/End to the corners, PageUp/PageDown by `seite` rows. null: the key does not move.
 */
export function naechsteZelle(
  von: PackZelle,
  taste: { key: string; ctrlKey?: boolean; metaKey?: boolean },
  zeilen: number,
  spalten: number,
  seite = 10
): PackZelle | null {
  if (!zeilen || !spalten) return null;
  const strg = taste.ctrlKey || taste.metaKey;
  let { zeile, spalte } = von;
  switch (taste.key) {
    case 'ArrowUp':
      zeile--;
      break;
    case 'ArrowDown':
      zeile++;
      break;
    case 'ArrowLeft':
      spalte--;
      break;
    case 'ArrowRight':
      spalte++;
      break;
    case 'Home':
      spalte = 0;
      if (strg) zeile = 0;
      break;
    case 'End':
      spalte = spalten - 1;
      if (strg) zeile = zeilen - 1;
      break;
    case 'PageUp':
      zeile -= seite;
      break;
    case 'PageDown':
      zeile += seite;
      break;
    default:
      return null;
  }
  return {
    zeile: Math.min(Math.max(zeile, 0), zeilen - 1),
    spalte: Math.min(Math.max(spalte, 0), spalten - 1),
  };
}
