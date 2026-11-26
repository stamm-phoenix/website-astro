import { kiPortionen } from '../../../api/lib/essen-ki-zutaten-model';
import type { KiZutatErgebnis, KiZutatPruefung } from '../../../api/lib/essen-ki-zutaten-model';
import type { PlanungZutat } from '../../../api/lib/essen-gerichte-model';
import type { EssenZutat } from '../../../api/lib/essen-validation';
import { kiFehlerText } from './essensplanungKi';
import type { EssenZutatInput } from './types/essen';

/**
 * „Zutaten prüfen (KI)“ in the browser: asks in portions the API takes, and builds the bodies
 * that take a proposal over (`docs/essensplanung.md`, „KI“).
 */

export interface KiZutatenLauf {
  ergebnisse: KiZutatErgebnis[];
  /** Why the check stopped early; null when every portion was answered. */
  fehler: string | null;
  /** The ids no portion answered yet, to go on with. */
  offen: number[];
}

/**
 * Checks `ids` in portions, `parallel` at a time. After an error (e.g. a busy AI) no new portion
 * starts; what was answered stays, and the ids not answered are returned for „Weiter prüfen“.
 * `abgebrochen` stops it the same way between portions.
 */
export async function kiZutatenPruefen(
  ids: readonly number[],
  frage: (portion: number[]) => Promise<KiZutatPruefung>,
  {
    fortschritt,
    abgebrochen = () => false,
    parallel = 3,
  }: {
    fortschritt?: (fertig: number, gesamt: number) => void;
    abgebrochen?: () => boolean;
    parallel?: number;
  } = {}
): Promise<KiZutatenLauf> {
  const ergebnisse: KiZutatErgebnis[] = [];
  const warten = kiPortionen(ids);
  const offen: number[] = [];
  let fehler: string | null = null;
  let fertig = 0;
  fortschritt?.(0, ids.length);
  async function arbeite(): Promise<void> {
    for (let portion = warten.shift(); portion; portion = warten.shift()) {
      if (fehler !== null || abgebrochen()) {
        offen.push(...portion);
        continue;
      }
      try {
        ergebnisse.push(...(await frage(portion)).ergebnisse);
        fertig += portion.length;
        fortschritt?.(fertig, ids.length);
      } catch (error: unknown) {
        fehler ??= kiFehlerText(error);
        offen.push(...portion);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, arbeite));
  const reihenfolge = new Map(ids.map((id, index) => [id, index]));
  return {
    ergebnisse,
    fehler,
    offen: offen.toSorted((a, b) => reihenfolge.get(a)! - reihenfolge.get(b)!),
  };
}

/** Results with a proposal first, then unclear and unanswered ones, those that fit last. */
export function kiZutatenSortiert(ergebnisse: readonly KiZutatErgebnis[]): KiZutatErgebnis[] {
  const rang = { vorschlag: 0, unklar: 1, ohne_antwort: 2, passt: 3 } as const;
  return ergebnisse.toSorted((a, b) => rang[a.status] - rang[b.status]);
}

/** The PATCH of an own ingredient of the Planung with the proposal, at the checked version. */
export function planungZutatKiBody(ergebnis: KiZutatErgebnis): Record<string, unknown> | null {
  const neu = ergebnis.vorschlag;
  if (!neu) return null;
  return {
    etag: ergebnis.etag,
    name: neu.name,
    kategorieId: neu.kategorieId,
    einheitenart: neu.einheitenart,
    vegetarisch: neu.vegetarisch,
    vegan: neu.vegan,
    allergene: neu.allergene,
  };
}

/**
 * A central ingredient with the proposal, at the checked version: what the AI does not check
 * (drained weight, the hint, whether a person checked the properties) stays.
 */
export function zentraleZutatKiBody(
  aktuell: EssenZutat,
  ergebnis: KiZutatErgebnis
): (EssenZutatInput & { id: number; etag: string }) | null {
  const neu = ergebnis.vorschlag;
  if (!neu) return null;
  return {
    id: aktuell.id,
    etag: ergebnis.etag,
    name: neu.name,
    kategorieId: neu.kategorieId,
    einheitenart: neu.einheitenart,
    abtropfgewicht: neu.einheitenart === 'masse' && aktuell.abtropfgewicht,
    lebensmittel: neu.lebensmittel,
    vegetarisch: neu.vegetarisch,
    vegan: neu.vegan,
    merkmaleGeprueft: aktuell.merkmaleGeprueft,
    hinweis: aktuell.hinweis,
    grammProTl: neu.grammProTl,
    grammProEl: neu.grammProEl,
    grammProStueck: neu.grammProStueck,
    allergene: neu.allergene,
  };
}

/** The own ingredients of a Planung the AI checks, in the order of the list. */
export function eigeneZutatIds(zutaten: readonly PlanungZutat[]): number[] {
  return zutaten.filter((zutat) => zutat.zutatId === null).map((zutat) => zutat.id);
}
