import { mahlzeitenReihenfolge } from '../../../api/lib/essen-teilnehmende-model';
import type {
  Einkauf,
  EinkaufHaken,
  EinkaufRegelArt,
} from '../../../api/lib/essen-einkaeufe-model';
import {
  bedarf,
  einkaufsMenge,
  inBasis,
  kochMenge,
  mengenSchluessel,
  ohneMenge,
  summiere,
} from './essensplanungRechnung';
import type { BasisEinheit, RechnungsMahlzeit, RechnungsStand } from './essensplanungRechnung';
import { lager, nurOffene } from './essensplanungLager';
import { erledigtOhneMenge, postenMenge } from './essensplanungEinkauf';
import type { LagerEinplanung, LagerStand } from './essensplanungLager';
import type { EinkaufPosten, Geschaeft, GerichtEinheit, PlanungZutat, ZusatzPosten } from './types';

/**
 * The lists of the shopping trips of a Planung (`docs/essensplanung.md`, Einkäufe). Trips go in
 * the order of their date (without one last) and position. A trip needs what the open meals up to
 * its last meal and the extra needs take, less what is in stock now and what earlier trips still
 * buy; only the ingredients of its shop (all without a shop), as the rules set by hand say.
 */

/** A planned dish as the trips need it: its amounts and whether it is still open. */
type EinkaufsEinplanung = RechnungsMahlzeit['einplanungen'][number] & LagerEinplanung;

export interface EinkaufsStand
  extends Omit<RechnungsStand, 'tage'>, Omit<LagerStand, 'tage' | 'bestand'> {
  tage: { mahlzeiten: (RechnungsMahlzeit & { einplanungen: EinkaufsEinplanung[] })[] }[];
  bestand: EinkaufPosten[];
  zutaten: PlanungZutat[];
  geschaefte: Geschaeft[];
  zusatzbedarf: ZusatzPosten[];
  einkaeufe: Einkauf[];
}

/** One thing on the list of a trip. */
export interface EinkaufListenPosten {
  /** `<planungZutatId>:<Basiseinheit>`, or `<planungZutatId>:` without an amount. */
  key: string;
  planungZutatId: number;
  name: string;
  abtropfgewicht: boolean;
  /** What to buy as planned, rounded up like the shopping list; null without an amount. */
  menge: number | null;
  einheit: GerichtEinheit | null;
  /** Without an amount from a dish („nach Gefühl“); else a thing of its own by name. */
  nachGefuehl: boolean;
  /** The rule set by hand for the ingredient on this trip. */
  regel: EinkaufRegelArt | null;
  /** What was ticked off for it; null while open. */
  haken: EinkaufHaken | null;
}

export interface EinkaufListe {
  einkauf: Einkauf;
  kategorien: { name: string; posten: EinkaufListenPosten[] }[];
  /** Things on the list, and how many of them are ticked off. */
  anzahl: number;
  abgehakt: number;
  /** Ingredients taken off this trip by hand („nicht in diesem Einkauf“). */
  ohne: { planungZutatId: number; name: string }[];
}

/** Below this nothing is left to buy, so rounding noise does not buy a whole piece. */
const REST = 1e-6;
const VERGLEICH = new Intl.Collator('de');

/** The trips in the order they are bought: by date (without one last), then position. */
export function einkaufsReihenfolge<E extends Pick<Einkauf, 'id' | 'datum' | 'position'>>(
  einkaeufe: E[]
): E[] {
  return [...einkaeufe].sort(
    (a, b) =>
      (a.datum ?? '9999-99-99').localeCompare(b.datum ?? '9999-99-99') ||
      a.position - b.position ||
      a.id - b.id
  );
}

const schluessel = mengenSchluessel;

/** An amount as bought, in its base unit: pieces, packs and bunches rounded up. */
function gekauft(menge: number, einheit: BasisEinheit): number {
  return einheit === 'g' || einheit === 'ml' ? menge : Math.ceil(menge - 1e-9);
}

/**
 * The list of every trip by its id. For trip P and ingredient z in base unit e:
 * planned(P, z) = max(0, needed up to P(z) − in stock now(z) − Σ planned(Q, z) of earlier trips Q
 * that are not finished and where z is not ticked off yet); a fixed amount set by hand is just
 * that. Something ticked off is in stock with what was bought, so a rest is bought on the next
 * trip. Things without an amount go on the first open trip that takes them.
 */
export function einkaufListen(
  stand: EinkaufsStand,
  /** Names of the categories of the central list; unknown ones read „Sonstiges“. */
  kategorien: Map<number, string>
): Map<number, EinkaufListe> {
  const offen = nurOffene(stand);
  const zutaten = new Map(stand.zutaten.map((zutat) => [zutat.id, zutat]));
  const reihenfolge = mahlzeitenReihenfolge(stand.tage);
  const geschaefte = new Set(stand.geschaefte.map((g) => g.id));
  // What is needed, per meal; extra needs count from the first trip on
  const bedarfe = bedarf(offen);
  const zusatz = stand.zusatzbedarf.flatMap((p) =>
    p.menge !== null && p.einheit !== null
      ? [{ planungZutatId: p.planungZutatId, menge: p.menge, einheit: p.einheit }]
      : []
  );
  // In stock now: before, plus what was bought, less what was used (below 0 counts as none)
  const imLager = new Map(
    lager(stand).map((p) => [schluessel(p.planungZutatId, p.einheit), p.jetzt])
  );
  /** All that is needed: a thing put on a trip by hand („mit“) brings all of its needs. */
  const noetigAlle = new Map(
    summiere([...bedarfe, ...zusatz]).map((s) => [schluessel(s.planungZutatId, s.einheit), s])
  );
  const gefuehl = ohneMenge(offen);
  /** Ingredients needed without an amount; ticked off, they keep the key without a unit. */
  const ohne = new Set([
    ...gefuehl,
    ...stand.zusatzbedarf.filter((p) => p.menge === null).map((p) => p.planungZutatId),
  ]);
  const mitMenge = new Set([...noetigAlle.values()].map((s) => s.planungZutatId));
  /** What earlier trips still buy, per ingredient and base unit. */
  const unterwegs = new Map<string, number>();
  const ergebnis = new Map<number, EinkaufListe>();
  const reihe = einkaufsReihenfolge(stand.einkaeufe);

  /**
   * Per ingredient the place in the order of the last open trip it was put on by hand („mit“,
   * e.g. moved there): trips before it without a rule of their own leave it to that trip.
   */
  const reserviert = new Map<number, number>();
  reihe.forEach((einkauf, index) => {
    if (einkauf.abgeschlossen) return;
    for (const regel of einkauf.regeln)
      if (regel.art === 'mit') reserviert.set(regel.planungZutatId, index);
  });

  /** Whether trip `einkauf` takes ingredient `id` by its shop and its rules. */
  const nimmt = (einkauf: Einkauf, id: number): boolean => {
    const regel = einkauf.regeln.find((r) => r.planungZutatId === id)?.art;
    if (regel === 'ohne') return false;
    if (regel === 'mit' || regel === 'fest') return true;
    if ((reserviert.get(id) ?? -1) > reihe.indexOf(einkauf)) return false;
    const geschaeft = zutaten.get(id)?.geschaeftId ?? null;
    return (
      einkauf.geschaeftId === null ||
      (geschaeft !== null && geschaefte.has(geschaeft) && geschaeft === einkauf.geschaeftId)
    );
  };

  const posten = new Map<number, Map<string, EinkaufListenPosten>>();
  const eintrag = (
    einkauf: Einkauf,
    id: number,
    key: string,
    werte: Pick<EinkaufListenPosten, 'menge' | 'einheit' | 'nachGefuehl'>
  ): EinkaufListenPosten | null => {
    const zutat = zutaten.get(id);
    if (!zutat) return null;
    const liste = posten.get(einkauf.id) ?? new Map<string, EinkaufListenPosten>();
    posten.set(einkauf.id, liste);
    const neu: EinkaufListenPosten = {
      key,
      planungZutatId: id,
      name: zutat.name,
      abtropfgewicht: zutat.abtropfgewicht,
      regel: einkauf.regeln.find((r) => r.planungZutatId === id)?.art ?? null,
      haken: null,
      ...werte,
    };
    liste.set(key, neu);
    return neu;
  };

  for (const einkauf of reihe) {
    const bis =
      einkauf.bisMahlzeitId !== null && reihenfolge.has(einkauf.bisMahlzeitId)
        ? reihenfolge.get(einkauf.bisMahlzeitId)!
        : Number.POSITIVE_INFINITY;
    const noetig = new Map(
      summiere([
        ...bedarfe.filter((b) => (reihenfolge.get(b.mahlzeitId) ?? 0) <= bis),
        ...zusatz,
      ]).map((s) => [schluessel(s.planungZutatId, s.einheit), s])
    );
    const fest = new Map(
      einkauf.regeln.flatMap((r) => {
        if (r.art !== 'fest' || r.menge === null || r.einheit === null) return [];
        const basis = inBasis(r.menge, r.einheit);
        return [[schluessel(r.planungZutatId, basis.einheit), basis] as const];
      })
    );
    /** The key of a fixed amount on this trip, by ingredient. */
    const festKey = new Map([...fest.keys()].map((key) => [Number(key.split(':')[0]), key]));
    /** Where a tick stands on the list of this trip. */
    const hakenKey = (h: EinkaufHaken): string => {
      const id = h.planungZutatId;
      // A fixed amount on this trip is what was ticked off
      const festerKey = festKey.get(id);
      if (festerKey) return festerKey;
      // A thing without an amount keeps its place when ticked off, also for others at once
      if (ohne.has(id) && !mitMenge.has(id)) return `${id}:`;
      return schluessel(id, inBasis(h.erhalten, h.einheit).einheit);
    };
    const hakenJe = new Map(einkauf.posten.map((h) => [hakenKey(h), h]));
    const mit = new Set(einkauf.regeln.filter((r) => r.art === 'mit').map((r) => r.planungZutatId));
    const keys = new Set([
      ...noetig.keys(),
      ...fest.keys(),
      ...[...noetigAlle.keys()].filter((key) => mit.has(Number(key.split(':')[0]))),
    ]);
    for (const key of keys) {
      const id = Number(key.split(':')[0]);
      // The base unit as first written („Dose“), for what is shown
      const basis: BasisEinheit = (noetig.get(key) ?? noetigAlle.get(key) ?? fest.get(key))!
        .einheit;
      const regel = einkauf.regeln.find((r) => r.planungZutatId === id);
      const haken = hakenJe.get(key) ?? null;
      // What was planned for something ticked off: without what was bought for it here
      const vorhanden = Math.max(
        0,
        (imLager.get(key) ?? 0) - (haken ? inBasis(haken.erhalten, haken.einheit).menge : 0)
      );
      let geplant = 0;
      if (regel?.art === 'fest') geplant = fest.get(key)?.menge ?? 0;
      else if (nimmt(einkauf, id))
        geplant = Math.max(
          0,
          // Moved here by hand: all it needs, whatever meals this trip covers
          ((regel?.art === 'mit' ? noetigAlle : noetig).get(key)?.menge ?? 0) -
            vorhanden -
            (unterwegs.get(key) ?? 0)
        );
      geplant = geplant > REST ? gekauft(geplant, basis) : 0;
      // A finished trip bought only what was ticked off; that is in stock
      if (einkauf.abgeschlossen) continue;
      if (!haken) unterwegs.set(key, (unterwegs.get(key) ?? 0) + geplant);
      if (geplant > 0 || (regel?.art === 'fest' && fest.has(key)))
        eintrag(einkauf, id, key, { ...einkaufsMenge(geplant, basis), nachGefuehl: false });
    }
    // Everything ticked off stands on the list, also when nothing more is planned
    for (const [key, haken] of hakenJe) {
      const liste = posten.get(einkauf.id);
      const vorhanden = liste?.get(key);
      if (vorhanden) vorhanden.haken = haken;
      else {
        const neu = eintrag(einkauf, haken.planungZutatId, key, {
          menge: null,
          einheit: null,
          nachGefuehl: false,
        });
        if (neu) neu.haken = haken;
      }
    }
  }

  // Without an amount: on the first open trip that takes it, unless it is on a list with an
  // amount, ticked off since it was put on the list, or in stock
  const gelistet = new Set(
    [...posten.values()].flatMap((liste) =>
      [...liste.values()].filter((p) => !p.key.endsWith(':')).map((p) => p.planungZutatId)
    )
  );
  const erledigt = erledigtOhneMenge(stand);
  const vorraetig = new Set(
    [...imLager].filter(([, menge]) => menge > 1e-9).map(([key]) => Number(key.split(':')[0]))
  );
  for (const id of ohne) {
    // As on the shopping list: stock covers what dishes need by eye, not what was put on it
    if (gelistet.has(id) || erledigt.has(id) || (gefuehl.has(id) && vorraetig.has(id))) continue;
    const einkauf = reihe.find((e) => !e.abgeschlossen && nimmt(e, id));
    // A trip where it is ticked off already shows it there
    if (einkauf && !posten.get(einkauf.id)?.has(`${id}:`))
      eintrag(einkauf, id, `${id}:`, { menge: null, einheit: null, nachGefuehl: gefuehl.has(id) });
  }

  for (const einkauf of stand.einkaeufe) {
    const jeKategorie = new Map<string, EinkaufListenPosten[]>();
    for (const p of posten.get(einkauf.id)?.values() ?? []) {
      const zutat = zutaten.get(p.planungZutatId)!;
      const kategorie = kategorien.get(zutat.kategorieId) ?? 'Sonstiges';
      jeKategorie.set(kategorie, [...(jeKategorie.get(kategorie) ?? []), p]);
    }
    const alle = [...(posten.get(einkauf.id)?.values() ?? [])];
    ergebnis.set(einkauf.id, {
      einkauf,
      kategorien: [...jeKategorie]
        .sort(([a], [b]) => VERGLEICH.compare(a, b))
        .map(([name, liste]) => ({
          name,
          posten: liste.sort((a, b) => VERGLEICH.compare(a.name, b.name)),
        })),
      anzahl: alle.length,
      abgehakt: alle.filter((p) => p.haken).length,
      ohne: einkauf.regeln
        .filter((r) => r.art === 'ohne')
        .flatMap((r) => {
          const zutat = zutaten.get(r.planungZutatId);
          return zutat ? [{ planungZutatId: zutat.id, name: zutat.name }] : [];
        })
        .sort((a, b) => VERGLEICH.compare(a.name, b.name)),
    });
  }
  return ergebnis;
}

/** A thing of a trip on paper: open ones with what is planned, ticked off ones with what was bought. */
export function einkaufDruckZeile(posten: EinkaufListenPosten): {
  abgehakt: boolean;
  menge: string;
  name: string;
} {
  const h = posten.haken;
  if (!h) return { abgehakt: false, menge: postenMenge(posten), name: posten.name };
  return {
    abgehakt: true,
    // Bought nothing of a thing without an amount: as before, without a number
    menge:
      h.erhalten > 0
        ? kochMenge(h.erhalten, h.einheit, posten.abtropfgewicht)
        : postenMenge(posten),
    name: h.ersatz ? `${posten.name} → ${h.ersatz}` : posten.name,
  };
}
