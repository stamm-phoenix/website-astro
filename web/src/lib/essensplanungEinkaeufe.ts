import { mahlzeitenReihenfolge } from '../../../api/lib/essen-teilnehmende-model';
import type {
  Einkauf,
  EinkaufHaken,
  EinkaufRegelArt,
} from '../../../api/lib/essen-einkaeufe-model';
import { bedarf, einkaufsMenge, inBasis, ohneMenge, summiere } from './essensplanungRechnung';
import type { BasisEinheit, RechnungsMahlzeit, RechnungsStand } from './essensplanungRechnung';
import { lager, nurOffene } from './essensplanungLager';
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

const schluessel = (id: number, einheit: BasisEinheit) => `${id}:${einheit}`;

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
  /** What earlier trips still buy, per ingredient and base unit. */
  const unterwegs = new Map<string, number>();
  const ergebnis = new Map<number, EinkaufListe>();
  const reihe = einkaufsReihenfolge(stand.einkaeufe);

  /** Whether trip `einkauf` takes ingredient `id` by its shop and its rules. */
  const nimmt = (einkauf: Einkauf, id: number): boolean => {
    const regel = einkauf.regeln.find((r) => r.planungZutatId === id)?.art;
    if (regel === 'ohne') return false;
    if (regel === 'mit' || regel === 'fest') return true;
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
    const hakenJe = new Map(
      einkauf.posten.map((h) => [
        schluessel(h.planungZutatId, inBasis(h.erhalten, h.einheit).einheit),
        h,
      ])
    );
    const keys = new Set([...noetig.keys(), ...fest.keys()]);
    for (const key of keys) {
      const [idText, basisText] = key.split(':');
      const id = Number(idText);
      const basis = basisText as BasisEinheit;
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
          (noetig.get(key)?.menge ?? 0) - vorhanden - (unterwegs.get(key) ?? 0)
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
  // amount, ticked off somewhere or in stock
  const gelistet = new Set(
    [...posten.values()].flatMap((liste) => [...liste.values()].map((p) => p.planungZutatId))
  );
  const vorraetig = new Set(
    [...imLager].filter(([, menge]) => menge > 1e-9).map(([key]) => Number(key.split(':')[0]))
  );
  const gefuehl = ohneMenge(offen);
  const ohne = new Set([
    ...gefuehl,
    ...stand.zusatzbedarf.filter((p) => p.menge === null).map((p) => p.planungZutatId),
  ]);
  for (const id of ohne) {
    if (gelistet.has(id) || vorraetig.has(id)) continue;
    const einkauf = reihe.find((e) => !e.abgeschlossen && nimmt(e, id));
    if (einkauf)
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
