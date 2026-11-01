import type { EinkaufPosten, ZusatzPosten } from './essen-einkauf-model';
import type { Einkauf } from './essen-einkaeufe-model';
import type { Gericht, GerichtEinheit } from './essen-gerichte-model';
import { einheitBasis, einheitSchluessel } from './essen-gerichte-model';
import type { EinplanungStatus, Verbrauch } from './essen-kochen-model';

/**
 * Units of one ingredient brought into line (`docs/essensplanung.md`, „Einheiten“): where an
 * ingredient of a Planung is measured in different base units (dishes in Bund, extra needs in g),
 * the page offers to convert the amounts into one unit. The AI proposes the unit and the factors;
 * the page shows the result and saves only what the member confirms. Every amount the stock is
 * worked out from converts with them (what was cooked, bought or set fixed on a trip), so the
 * shopping list stays right. Without imports of zod, so the website uses it too.
 */

/**
 * Where an amount of an ingredient stands: a line of a dish, extra needs, stock, what a cooked
 * dish used (`id` is the planned dish), what was bought on a trip (`id` is the thing ticked off)
 * or a fixed amount on a trip (`id` is the trip).
 */
export type EinheitenStelle =
  'gericht' | 'zusatzbedarf' | 'bestand' | 'verbrauch' | 'erhalten' | 'fest';

export const EINHEITEN_STELLEN: readonly EinheitenStelle[] = [
  'gericht',
  'zusatzbedarf',
  'bestand',
  'verbrauch',
  'erhalten',
  'fest',
];

/** One amount of an ingredient, as it is converted. */
export interface EinheitenVorkommen {
  stelle: EinheitenStelle;
  id: number;
  /** The version it is saved with: of the line, the planned dish or the trip. */
  etag: string;
  menge: number;
  einheit: GerichtEinheit;
  /** Where it is, e.g. „Chili sin Carne“ or „Zusatzbedarf“. */
  wo: string;
  /** People of the dish, for the AI; null outside a dish. */
  personen: number | null;
}

/** The parts of a Planung that hold amounts; dishes cooked and trips are optional. */
export interface EinheitenStand {
  gerichte: Pick<Gericht, 'id' | 'name' | 'personen' | 'zutaten'>[];
  zusatzbedarf: Pick<ZusatzPosten, 'id' | 'etag' | 'planungZutatId' | 'menge' | 'einheit'>[];
  bestand: Pick<EinkaufPosten, 'id' | 'etag' | 'planungZutatId' | 'menge' | 'einheit'>[];
  tage?: {
    mahlzeiten: {
      einplanungen: {
        id: number;
        etag: string;
        gerichtId: number;
        status?: EinplanungStatus;
        verbrauch?: Verbrauch[];
      }[];
    }[];
  }[];
  einkaeufe?: (Pick<Einkauf, 'id' | 'etag' | 'name' | 'regeln'> & {
    posten: Pick<
      Einkauf['posten'][number],
      'id' | 'etag' | 'planungZutatId' | 'einheit' | 'erhalten'
    >[];
  })[];
}

/** Most amounts converted at once: every amount of one ingredient. */
export const MAX_EINHEITEN_ZEILEN = 4000;

const STELLE_TEXT = { zusatzbedarf: 'Zusatzbedarf', bestand: 'Bestand' } as const;

/**
 * Every amount of `planungZutatId`: lines of dishes, extra needs and stock with an amount, what
 * cooked dishes used and what trips bought (both above 0), and fixed amounts on trips.
 */
export function einheitenVorkommen(
  stand: EinheitenStand,
  planungZutatId: number
): EinheitenVorkommen[] {
  const ergebnis: EinheitenVorkommen[] = [];
  const hinzu = (eintrag: Omit<EinheitenVorkommen, 'personen'>, personen: number | null = null) =>
    ergebnis.push({ ...eintrag, personen });
  for (const gericht of stand.gerichte)
    for (const zeile of gericht.zutaten)
      if (zeile.planungZutatId === planungZutatId && zeile.menge !== null && zeile.einheit)
        hinzu(
          {
            stelle: 'gericht',
            id: zeile.id,
            etag: zeile.etag,
            menge: zeile.menge,
            einheit: zeile.einheit,
            wo: gericht.name,
          },
          zeile.fest ? null : gericht.personen
        );
  for (const stelle of ['zusatzbedarf', 'bestand'] as const)
    for (const posten of stand[stelle])
      if (posten.planungZutatId === planungZutatId && posten.menge !== null && posten.einheit)
        hinzu({
          stelle,
          id: posten.id,
          etag: posten.etag,
          menge: posten.menge,
          einheit: posten.einheit,
          wo: STELLE_TEXT[stelle],
        });
  const gerichtName = new Map(stand.gerichte.map((g) => [g.id, g.name]));
  for (const einplanung of (stand.tage ?? []).flatMap((tag) =>
    tag.mahlzeiten.flatMap((mahlzeit) => mahlzeit.einplanungen)
  )) {
    if (einplanung.status !== 'gekocht') continue;
    for (const v of einplanung.verbrauch ?? [])
      if (v.planungZutatId === planungZutatId && v.menge > 0)
        hinzu({
          stelle: 'verbrauch',
          id: einplanung.id,
          etag: einplanung.etag,
          menge: v.menge,
          einheit: v.einheit,
          wo: `${gerichtName.get(einplanung.gerichtId) ?? 'Gericht'} (gekocht)`,
        });
  }
  for (const einkauf of stand.einkaeufe ?? []) {
    for (const haken of einkauf.posten)
      if (haken.planungZutatId === planungZutatId && haken.erhalten > 0)
        hinzu({
          stelle: 'erhalten',
          id: haken.id,
          etag: haken.etag,
          menge: haken.erhalten,
          einheit: haken.einheit,
          wo: `Einkauf ${einkauf.name} (gekauft)`,
        });
    for (const regel of einkauf.regeln)
      if (
        regel.planungZutatId === planungZutatId &&
        regel.art === 'fest' &&
        regel.menge !== null &&
        regel.menge > 0 &&
        regel.einheit
      )
        hinzu({
          stelle: 'fest',
          id: einkauf.id,
          etag: einkauf.etag,
          menge: regel.menge,
          einheit: regel.einheit,
          wo: `Einkauf ${einkauf.name} (feste Menge)`,
        });
  }
  return ergebnis;
}

/**
 * The ingredients whose amounts stand in more than one base unit (kg and g are one), with those
 * units as first written; these are offered to be brought into line.
 */
export function uneinheitlicheZutaten(stand: EinheitenStand): Map<number, GerichtEinheit[]> {
  const ids = new Set<number>([
    ...stand.gerichte.flatMap((g) => g.zutaten.map((zeile) => zeile.planungZutatId)),
    ...stand.zusatzbedarf.map((p) => p.planungZutatId),
    ...stand.bestand.map((p) => p.planungZutatId),
    ...(stand.einkaeufe ?? []).flatMap((e) => e.posten.map((p) => p.planungZutatId)),
  ]);
  const ergebnis = new Map<number, GerichtEinheit[]>();
  for (const id of ids) {
    const einheiten = new Map<string, GerichtEinheit>();
    for (const eintrag of einheitenVorkommen(stand, id)) {
      const basis = einheitSchluessel(eintrag.einheit);
      if (!einheiten.has(basis)) einheiten.set(basis, einheitBasis(eintrag.einheit).einheit);
    }
    if (einheiten.size > 1) ergebnis.set(id, [...einheiten.values()]);
  }
  return ergebnis;
}

/** The units of `vorkommen`, each once (upper and lower case alike), as written first. */
export function vorkommendeEinheiten(
  vorkommen: readonly Pick<EinheitenVorkommen, 'einheit'>[]
): GerichtEinheit[] {
  const gesehen = new Map<string, GerichtEinheit>();
  for (const eintrag of vorkommen) {
    const key = eintrag.einheit.toLocaleLowerCase('de');
    if (!gesehen.has(key)) gesehen.set(key, eintrag.einheit);
  }
  return [...gesehen.values()];
}

/** How many of `nach` one `von` is, where that is certain (g and kg, ml and l); else null. */
export function sichererFaktor(von: GerichtEinheit, nach: GerichtEinheit): number | null {
  if (einheitSchluessel(von) !== einheitSchluessel(nach)) return null;
  return einheitBasis(von).mal / einheitBasis(nach).mal;
}

/** A converted amount rounded like a cook writes it: three places, two for counted units. */
export function rundeMenge(menge: number, einheit: GerichtEinheit): number {
  const stellen =
    ['g', 'ml'].includes(einheit) && menge >= 10 ? 0 : einheit === 'kg' || einheit === 'l' ? 3 : 2;
  const faktor = 10 ** stellen;
  return Math.max(0.001, Math.round(menge * faktor) / faktor);
}

/** The AI's proposal for one ingredient: a target unit and, per unit found, its factor. */
export interface KiEinheiten {
  planungZutatId: number;
  /** The unit all amounts are converted into, e.g. „Bund“ for herbs. */
  ziel: GerichtEinheit;
  /** One sentence why; empty when the model gives none. */
  begruendung: string;
  /** Per unit found: how many of `ziel` one of it is; null when the model cannot say. */
  faktoren: { einheit: GerichtEinheit; faktor: number | null }[];
}

/**
 * An amount converted, as the page sends it to be saved with the version it saw. `von` is the
 * unit it had, which tells the entries of a cooked dish apart.
 */
export interface EinheitenZeileInput {
  stelle: EinheitenStelle;
  id: number;
  etag: string;
  menge: number;
  einheit: GerichtEinheit;
  von: GerichtEinheit;
}
