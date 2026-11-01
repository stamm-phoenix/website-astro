import {
  BEKANNTE_EINHEITEN,
  EINHEITEN_JE_ART,
  HAUSHALTS_EINHEITEN,
  einheitText,
  istBekannteEinheit,
  mengeText,
} from '../../../api/lib/essen-gerichte-model';
import type { EssenEinheitenart } from '../../../api/lib/essen-validation';
import {
  einheitenVorkommen,
  rundeMenge,
  type EinheitenStand,
  type EinheitenStelle,
} from '../../../api/lib/essen-einheiten-model';
import type { GerichtEinheit } from './types';
import type { Vorschlag } from './vorschlaege';

/**
 * Units in the Essensplanung (`docs/essensplanung.md`, „Einheiten“): what the unit fields
 * suggest, and the preview of bringing the units of one ingredient into line.
 */

/**
 * Suggestions of a unit field: the units of the ingredient's kind first, then every other known
 * unit, the kitchen units and those the Planung already uses. Any typed text stays possible.
 */
export function einheitenVorschlaege(
  art: EssenEinheitenart | null,
  eigene: readonly string[] = [],
  abtropfgewicht = false
): Vorschlag[] {
  const passend: readonly string[] = art ? EINHEITEN_JE_ART[art] : [];
  const gesehen = new Set<string>();
  const vorschlaege: Vorschlag[] = [];
  const hinzu = (einheit: string, gruppe: string) => {
    const key = einheit.toLocaleLowerCase('de');
    if (gesehen.has(key)) return;
    gesehen.add(key);
    vorschlaege.push({
      value: einheitText(einheit, abtropfgewicht && passend.includes(einheit)),
      gruppe,
    });
  };
  for (const einheit of passend) hinzu(einheit, 'Passend');
  for (const einheit of [...BEKANNTE_EINHEITEN, ...HAUSHALTS_EINHEITEN, ...eigene])
    hinzu(einheit, 'Weitere');
  return vorschlaege;
}

const eigeneJeStand = new WeakMap<object, string[]>();

/**
 * The units of one's own a Planung uses, to suggest them again; worked out once per state, as
 * every row of the page asks.
 */
export function eigeneEinheiten(stand: EinheitenStand): string[] {
  const bekannt = eigeneJeStand.get(stand);
  if (bekannt) return bekannt;
  const ergebnis = sammleEigene(stand);
  eigeneJeStand.set(stand, ergebnis);
  return ergebnis;
}

function sammleEigene(stand: EinheitenStand): string[] {
  const einheiten = [
    ...stand.gerichte.flatMap((gericht) => gericht.zutaten.map((zeile) => zeile.einheit)),
    ...stand.zusatzbedarf.map((posten) => posten.einheit),
    ...stand.bestand.map((posten) => posten.einheit),
  ];
  return [...new Set(einheiten.filter((e): e is string => Boolean(e) && !istBekannteEinheit(e)))];
}

/** One amount in the preview: as it is, and as it would be in the target unit. */
export interface VorschauZeile {
  stelle: EinheitenStelle;
  id: number;
  etag: string;
  wo: string;
  vorher: string;
  /** The unit it has now. */
  von: GerichtEinheit;
  /** null while the factor of its unit is missing. */
  nachher: string | null;
  menge: number | null;
  einheit: GerichtEinheit;
}

/**
 * Every amount of an ingredient converted into `ziel`, with the factor of its unit (keyed by the
 * unit in lower case: how many `ziel` one of it is).
 */
export function vorschau(
  stand: EinheitenStand,
  planungZutatId: number,
  ziel: GerichtEinheit,
  faktoren: ReadonlyMap<string, number>
): VorschauZeile[] {
  return einheitenVorkommen(stand, planungZutatId).map((eintrag) => {
    const faktor = faktoren.get(eintrag.einheit.toLocaleLowerCase('de'));
    const menge = faktor && faktor > 0 ? rundeMenge(eintrag.menge * faktor, ziel) : null;
    return {
      stelle: eintrag.stelle,
      id: eintrag.id,
      etag: eintrag.etag,
      wo: eintrag.wo,
      vorher: mengeText(eintrag.menge, eintrag.einheit) ?? '',
      von: eintrag.einheit,
      nachher: menge === null ? null : mengeText(menge, ziel),
      menge,
      einheit: ziel,
    };
  });
}
