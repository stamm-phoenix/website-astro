import { EINHEITEN_JE_ART, mengeText } from '../../../api/lib/essen-gerichte-model';
import { bedarf, einkaufsMenge, ohneMenge, summiere } from './essensplanungRechnung';
import type { RechnungsStand } from './essensplanungRechnung';
import type { EinkaufPosten, Geschaeft, GerichtEinheit, PlanungZutat, ZusatzPosten } from './types';

/**
 * The shopping list of a Planung (`docs/essensplanung.md`, Einkaufsliste): what the planned dishes
 * and the extra needs take, less the stock, by shop and category, rounded up only at the end.
 */

/**
 * One thing to buy; without amount and unit when the dishes give none („nach Gefühl“) or it was
 * put on the list without one („Kochhandschuhe“).
 */
export interface EinkaufsPosten {
  planungZutatId: number;
  name: string;
  abtropfgewicht: boolean;
  menge: number | null;
  einheit: GerichtEinheit | null;
  /** Without an amount because a dish gives none, read „nach Gefühl“; else just the name. */
  nachGefuehl: boolean;
}

/** What stands before the name of a thing to buy: „2 kg“, „nach Gefühl“ or nothing. */
export function postenMenge(posten: EinkaufsPosten): string {
  return (
    mengeText(posten.menge, posten.einheit, posten.abtropfgewicht) ??
    (posten.nachGefuehl ? 'nach Gefühl' : '')
  );
}

export interface EinkaufsKategorie {
  name: string;
  posten: EinkaufsPosten[];
}

/** The list of one shop; `geschaeft` null for the things without a shop yet. */
export interface EinkaufsGeschaeft {
  geschaeft: Geschaeft | null;
  kategorien: EinkaufsKategorie[];
}

/** Every unit, for a thing of its own on the list, which can be measured in any. */
export const ALLE_EINHEITEN = Object.values(EINHEITEN_JE_ART).flat();

/** Below this nothing is left to buy, so rounding noise does not buy a whole piece. */
const REST = 1e-6;

const VERGLEICH = new Intl.Collator('de');

export function einkaufsliste(
  stand: RechnungsStand & {
    zutaten: PlanungZutat[];
    geschaefte: Geschaeft[];
    bestand: EinkaufPosten[];
    zusatzbedarf: ZusatzPosten[];
  },
  /** Names of the categories of the central list; unknown ones read „Sonstiges“. */
  kategorien: Map<number, string>
): EinkaufsGeschaeft[] {
  const zutaten = new Map(stand.zutaten.map((zutat) => [zutat.id, zutat]));
  const vorhanden = new Map(
    summiere(stand.bestand).map((summe) => [
      `${summe.planungZutatId}:${summe.einheit}`,
      summe.menge,
    ])
  );
  const geschaefte = new Map<number | null, Map<string, EinkaufsPosten[]>>();
  const gelistet = new Set<number>();
  const hinzu = (
    zutat: PlanungZutat,
    menge: Pick<EinkaufsPosten, 'menge' | 'einheit' | 'nachGefuehl'>
  ): void => {
    gelistet.add(zutat.id);
    const geschaeftId = stand.geschaefte.some((g) => g.id === zutat.geschaeftId)
      ? zutat.geschaeftId
      : null;
    const kategorie = kategorien.get(zutat.kategorieId) ?? 'Sonstiges';
    const jeKategorie = geschaefte.get(geschaeftId) ?? new Map<string, EinkaufsPosten[]>();
    geschaefte.set(geschaeftId, jeKategorie);
    jeKategorie.set(kategorie, [
      ...(jeKategorie.get(kategorie) ?? []),
      {
        planungZutatId: zutat.id,
        name: zutat.name,
        abtropfgewicht: zutat.abtropfgewicht,
        ...menge,
      },
    ]);
  };
  const mitMenge = stand.zusatzbedarf.filter(
    (posten): posten is EinkaufPosten => posten.menge !== null && posten.einheit !== null
  );
  for (const summe of summiere([...bedarf(stand), ...mitMenge])) {
    const rest = summe.menge - (vorhanden.get(`${summe.planungZutatId}:${summe.einheit}`) ?? 0);
    const zutat = zutaten.get(summe.planungZutatId);
    if (rest > REST && zutat)
      hinzu(zutat, { ...einkaufsMenge(rest, summe.einheit), nachGefuehl: false });
  }
  // Without an amount (from dishes, or extra needs like „Kochhandschuhe“): on the list unless it
  // is listed with one or there is some in stock
  const imBestand = new Set(stand.bestand.map((posten) => posten.planungZutatId));
  const gefuehl = new Set(ohneMenge(stand));
  const ohne = [
    ...gefuehl,
    ...stand.zusatzbedarf.filter((posten) => posten.menge === null).map((p) => p.planungZutatId),
  ];
  for (const id of new Set(ohne)) {
    const zutat = zutaten.get(id);
    if (zutat && !gelistet.has(id) && !imBestand.has(id))
      hinzu(zutat, { menge: null, einheit: null, nachGefuehl: gefuehl.has(id) });
  }
  const ordnen = (jeKategorie: Map<string, EinkaufsPosten[]>): EinkaufsKategorie[] =>
    [...jeKategorie]
      .sort(([a], [b]) => VERGLEICH.compare(a, b))
      .map(([name, posten]) => ({
        name,
        posten: posten.sort((a, b) => VERGLEICH.compare(a.name, b.name)),
      }));
  return [...stand.geschaefte, null]
    .filter((geschaeft) => geschaefte.has(geschaeft?.id ?? null))
    .map((geschaeft) => ({
      geschaeft,
      kategorien: ordnen(geschaefte.get(geschaeft?.id ?? null)!),
    }));
}
