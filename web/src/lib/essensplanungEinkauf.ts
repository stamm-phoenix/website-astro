import { mengeText } from '../../../api/lib/essen-gerichte-model';
import {
  bedarf,
  einkaufsMenge,
  mengenSchluessel,
  ohneMenge,
  summiere,
} from './essensplanungRechnung';
import type { RechnungsStand } from './essensplanungRechnung';
import { nurOffene, vorraetig } from './essensplanungLager';
import type { LagerStand } from './essensplanungLager';
import type { EinkaufPosten, Geschaeft, GerichtEinheit, PlanungZutat, ZusatzPosten } from './types';

/**
 * The shopping list of a Planung (`docs/essensplanung.md`, Einkaufsliste): what the planned dishes
 * still open and the extra needs take, less what is in stock now, by shop and category, rounded up
 * only at the end.
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

/** Below this nothing is left to buy, so rounding noise does not buy a whole piece. */
const REST = 1e-6;

const VERGLEICH = new Intl.Collator('de');

/**
 * Ingredients without an amount that were ticked off on a trip after they were last put on the
 * list: a tick covers what was needed when it was made. Versions (rowversions) grow with every
 * change across the database, so a row of extra needs newer than the tick (its `stand`, the state
 * of the database when it was ticked off) is a new need. For
 * what only dishes need by eye, a tick with an amount counts through the stock (bought and used
 * up, it is needed again); only a tick without one, which the stock cannot show, covers it.
 */
export function erledigtOhneMenge(stand: {
  einkaeufe?: {
    posten: { planungZutatId: number; etag?: string; stand?: string; erhalten?: number }[];
  }[];
  zusatzbedarf: Pick<ZusatzPosten, 'planungZutatId' | 'menge' | 'etag'>[];
}): Set<number> {
  const neuester = new Map<number, string>();
  for (const p of stand.zusatzbedarf) {
    if (p.menge !== null) continue;
    if (p.etag > (neuester.get(p.planungZutatId) ?? '')) neuester.set(p.planungZutatId, p.etag);
  }
  const erledigt = new Set<number>();
  for (const haken of (stand.einkaeufe ?? []).flatMap((e) => e.posten)) {
    const bedarf = neuester.get(haken.planungZutatId);
    // When it was ticked off; bringing units into line gives it a new version, not a new tick
    const abgehakt = haken.stand ?? haken.etag;
    // The state is the database's newest version at the tick: a need of exactly that version
    // was written before it
    const erledigtHaken =
      bedarf === undefined ? !(haken.erhalten ?? 0) : abgehakt === undefined || abgehakt >= bedarf;
    if (erledigtHaken) erledigt.add(haken.planungZutatId);
  }
  return erledigt;
}

export function einkaufsliste(
  alles: RechnungsStand &
    LagerStand & {
      zutaten: PlanungZutat[];
      geschaefte: Geschaeft[];
      bestand: EinkaufPosten[];
      zusatzbedarf: ZusatzPosten[];
    },
  /** Names of the categories of the central list; unknown ones read „Sonstiges“. */
  kategorien: Map<number, string>
): EinkaufsGeschaeft[] {
  // Dishes cooked or left out need nothing more; what is in stock now counts
  const stand = nurOffene(alles);
  const zutaten = new Map(stand.zutaten.map((zutat) => [zutat.id, zutat]));
  // The stock from all dishes: the cooked ones used some of it
  const vorhanden = vorraetig(alles);
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
    const rest =
      summe.menge - (vorhanden.get(mengenSchluessel(summe.planungZutatId, summe.einheit)) ?? 0);
    const zutat = zutaten.get(summe.planungZutatId);
    if (rest > REST && zutat)
      hinzu(zutat, { ...einkaufsMenge(rest, summe.einheit), nachGefuehl: false });
  }
  // Without an amount (from dishes, or extra needs like „Kochhandschuhe“): on the list unless it
  // is listed with one; from dishes also unless there is some in stock now
  const imBestand = new Set([...vorhanden.keys()].map((key) => Number(key.split(':')[0])));
  const gefuehl = new Set(ohneMenge(stand));
  const ohne = [
    ...gefuehl,
    ...stand.zusatzbedarf.filter((posten) => posten.menge === null).map((p) => p.planungZutatId),
  ];
  // Ticked off on a trip after it was put on the list: it is there, like on the trips
  const abgehakt = erledigtOhneMenge(alles);
  for (const id of new Set(ohne)) {
    const zutat = zutaten.get(id);
    // What a dish needs „nach Gefühl“ is covered by stock; what was put on the list is bought
    if (zutat && !gelistet.has(id) && !abgehakt.has(id) && !(gefuehl.has(id) && imBestand.has(id)))
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
