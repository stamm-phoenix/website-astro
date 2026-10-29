import { inBasis, kochMenge, summiere, zeilenMenge } from './essensplanungRechnung';
import type {
  BasisEinheit,
  RechnungsGericht,
  RechnungsMahlzeit,
  RechnungsStand,
  esserRechner,
} from './essensplanungRechnung';
import type { GerichtEinheit } from '../../../api/lib/essen-gerichte-model';
import type { EinkaufPosten, PlanungZutat } from './types';
import type { EinplanungStatus, Verbrauch } from '../../../api/lib/essen-kochen-model';
import type { EinkaufHaken } from '../../../api/lib/essen-einkaeufe-model';

/**
 * The stock of a Planung during the Aktion (`docs/essensplanung.md`, Lager): what was there
 * before, plus what was ticked off while shopping, less what the cooked dishes used.
 */

/** A planned dish as the stock needs it: whether it was cooked, and what it used then. */
export interface LagerEinplanung {
  status?: EinplanungStatus;
  verbrauch?: Verbrauch[];
}

export interface LagerStand {
  tage: { mahlzeiten: { einplanungen: LagerEinplanung[] }[] }[];
  bestand: Pick<EinkaufPosten, 'planungZutatId' | 'menge' | 'einheit'>[];
  /** Shopping trips; what was ticked off on them is in stock. */
  einkaeufe?: {
    posten: (Pick<EinkaufHaken, 'planungZutatId' | 'erhalten' | 'einheit'> & {
      ersatz?: string;
    })[];
  }[];
}

/**
 * One ingredient in one unit: there before, bought, used, and there now (below 0: more used than
 * had).
 */
export interface LagerPosten {
  planungZutatId: number;
  einheit: BasisEinheit;
  anfang: number;
  erhalten: number;
  verbraucht: number;
  jetzt: number;
}

const schluessel = (id: number, einheit: BasisEinheit) => `${id}:${einheit}`;

/** Whether a planned dish still counts towards what is needed. */
export function offen(einplanung: LagerEinplanung): boolean {
  return (einplanung.status ?? 'offen') === 'offen';
}

/** The stock per ingredient and unit, in the order the ingredients first appear. */
export function lager(stand: LagerStand): LagerPosten[] {
  const posten = new Map<string, LagerPosten>();
  const eintrag = (id: number, einheit: BasisEinheit): LagerPosten => {
    const key = schluessel(id, einheit);
    const vorhanden = posten.get(key);
    if (vorhanden) return vorhanden;
    const neu = { planungZutatId: id, einheit, anfang: 0, erhalten: 0, verbraucht: 0, jetzt: 0 };
    posten.set(key, neu);
    return neu;
  };
  for (const summe of summiere(stand.bestand)) {
    eintrag(summe.planungZutatId, summe.einheit).anfang += summe.menge;
  }
  const gekauft = (stand.einkaeufe ?? [])
    .flatMap((einkauf) => einkauf.posten)
    .map((p) => ({ planungZutatId: p.planungZutatId, menge: p.erhalten, einheit: p.einheit }));
  for (const summe of summiere(gekauft)) {
    eintrag(summe.planungZutatId, summe.einheit).erhalten += summe.menge;
  }
  const verbrauch = stand.tage
    .flatMap((tag) => tag.mahlzeiten.flatMap((mahlzeit) => mahlzeit.einplanungen))
    .filter((einplanung) => einplanung.status === 'gekocht')
    .flatMap((einplanung) => einplanung.verbrauch ?? []);
  for (const summe of summiere(verbrauch)) {
    eintrag(summe.planungZutatId, summe.einheit).verbraucht += summe.menge;
  }
  for (const p of posten.values()) p.jetzt = p.anfang + p.erhalten - p.verbraucht;
  return [...posten.values()];
}

/** What is in stock now per ingredient and unit, only what is left (more than 0). */
export function vorraetig(stand: LagerStand): Map<string, number> {
  return new Map(
    lager(stand)
      .filter((p) => p.jetzt > 1e-9)
      .map((p) => [schluessel(p.planungZutatId, p.einheit), p.jetzt])
  );
}

/** The Planung with only the planned dishes still needed, for the shopping list. */
export function nurOffene<S extends RechnungsStand>(stand: S): S {
  return {
    ...stand,
    tage: stand.tage.map((tag) => ({
      ...tag,
      mahlzeiten: tag.mahlzeiten.map((mahlzeit) => ({
        ...mahlzeit,
        einplanungen: mahlzeit.einplanungen.filter((e) => offen(e as LagerEinplanung)),
      })),
    })),
  };
}

/** A row of the stock as shown and printed: „1,5 kg“; nothing left reads 0. */
export interface LagerZeile {
  planungZutatId: number;
  name: string;
  /** What was bought instead, „→ Pepsi Cola“; empty for none. */
  ersatz: string;
  anfang: string;
  erhalten: string;
  verbraucht: string;
  jetzt: string;
  /** Nothing left of it. */
  leer: boolean;
}

/** What was bought instead of an ingredient, „→ Pepsi Cola“; empty for nothing. */
export function ersatzText(stand: Pick<LagerStand, 'einkaeufe'>, planungZutatId: number): string {
  const namen = new Set(
    (stand.einkaeufe ?? [])
      .flatMap((einkauf) => einkauf.posten)
      .filter((p) => p.planungZutatId === planungZutatId)
      .map((p) => p.ersatz ?? '')
      .filter(Boolean)
  );
  return namen.size ? `→ ${[...namen].join(', ')}` : '';
}

/** The stock by name, with what was there, bought, used and what is left. */
export function lagerZeilen(stand: LagerStand & { zutaten: PlanungZutat[] }): LagerZeile[] {
  const zutaten = new Map(stand.zutaten.map((zutat) => [zutat.id, zutat]));
  return lager(stand)
    .flatMap((p) => {
      const zutat = zutaten.get(p.planungZutatId);
      if (!zutat || (p.anfang <= 0 && p.erhalten <= 0 && p.verbraucht <= 0)) return [];
      const text = (menge: number) =>
        kochMenge(Math.max(menge, 0), p.einheit, zutat.abtropfgewicht);
      return [
        {
          planungZutatId: p.planungZutatId,
          name: zutat.name,
          ersatz: ersatzText(stand, p.planungZutatId),
          anfang: text(p.anfang),
          erhalten: text(p.erhalten),
          verbraucht: text(p.verbraucht),
          jetzt: text(p.jetzt),
          leer: p.jetzt <= 1e-9,
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Large grams and millilitres in kg and l, rounded to what is stored. */
function anzeige(menge: number, einheit: BasisEinheit): { menge: number; einheit: GerichtEinheit } {
  const gross = menge >= 1000 && (einheit === 'g' || einheit === 'ml');
  const wert = gross ? menge / 1000 : menge;
  return {
    menge: Math.round(wert * 1000) / 1000,
    einheit: gross ? (einheit === 'g' ? 'kg' : 'l') : einheit,
  };
}

/**
 * What a planned dish uses as planned, per ingredient and unit: the amounts of its lines at its
 * meal, summed. Lines without an amount („nach Gefühl“) are left out.
 */
export function geplanterVerbrauch(
  gericht: RechnungsGericht | undefined,
  mahlzeit: Pick<RechnungsMahlzeit, 'id' | 'ohneGruppen'>,
  faktor: number,
  esser: ReturnType<typeof esserRechner>
): Verbrauch[] {
  if (!gericht) return [];
  const mengen = gericht.zutaten.flatMap((zeile) => {
    if (zeile.einheit === null) return [];
    const wer = zeile.fest ? 0 : esser(mahlzeit, zeile);
    const menge = zeilenMenge(zeile, gericht.personen, wer, faktor);
    return menge === null
      ? []
      : [{ planungZutatId: zeile.planungZutatId, menge, einheit: zeile.einheit }];
  });
  return summiere(mengen).map((summe) => ({
    planungZutatId: summe.planungZutatId,
    ...anzeige(summe.menge, summe.einheit),
  }));
}

/** Whether two amounts are the same, compared in their base unit. */
export function gleicheMenge(
  a: { menge: number; einheit: GerichtEinheit },
  b: { menge: number; einheit: GerichtEinheit }
): boolean {
  const x = inBasis(a.menge, a.einheit);
  const y = inBasis(b.menge, b.einheit);
  return x.einheit === y.einheit && Math.abs(x.menge - y.menge) < 1e-6;
}
