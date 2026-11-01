import { mahlzeitenReihenfolge } from '../../../api/lib/essen-teilnehmende-model';
import { mengeText } from '../../../api/lib/essen-gerichte-model';
import { nurOffene } from './essensplanungLager';
import type { LagerEinplanung } from './essensplanungLager';
import { bedarf, kochMenge, ohneMengeZeilen, summiere } from './essensplanungRechnung';
import type { RechnungsGericht, RechnungsMahlzeit, RechnungsStand } from './essensplanungRechnung';
import type { PlanungZutat, ZusatzPosten } from './types';

/**
 * Where a thing on a shopping list comes from (`docs/essensplanung.md`, „Für welche Gerichte“):
 * the open planned dishes that need the ingredient, with their ID like `1_2_1` and what each
 * needs, and the extra needs. By ingredient, whatever unit each line is measured in.
 */

export interface HerkunftGericht {
  einplanungId: number;
  mahlzeitId: number;
  gerichtId: number;
  name: string;
  /** `1_2_1`, as in the plan. */
  kennung: string;
  /** What this dish needs, „2,5 kg“ or „2 Stück + 100 g“; null when only by eye. */
  menge: string | null;
}

export interface HerkunftZusatz {
  id: number;
  /** „2 Packung“; null without an amount. */
  menge: string | null;
  hinweis: string;
}

export interface PostenHerkunft {
  gerichte: HerkunftGericht[];
  zusatz: HerkunftZusatz[];
}

export interface HerkunftStand extends RechnungsStand {
  tage: {
    mahlzeiten: (RechnungsMahlzeit & {
      kennung: string;
      einplanungen: (RechnungsMahlzeit['einplanungen'][number] & LagerEinplanung)[];
    })[];
  }[];
  gerichte: (RechnungsGericht & { name: string })[];
  zutaten: Pick<PlanungZutat, 'id' | 'abtropfgewicht'>[];
  zusatzbedarf: Pick<ZusatzPosten, 'id' | 'planungZutatId' | 'menge' | 'einheit' | 'hinweis'>[];
}

/**
 * The origin of every ingredient still needed, by its id. `bisMahlzeitId` keeps only dishes of
 * meals up to that one in the order of the plan (a trip „für die Mahlzeiten bis“); null, or a
 * meal no longer there, keeps all. Cooked and left out dishes need nothing more.
 */
export function herkunft(
  stand: HerkunftStand,
  bisMahlzeitId: number | null = null
): Map<number, PostenHerkunft> {
  const reihenfolge = mahlzeitenReihenfolge(stand.tage);
  const bis =
    bisMahlzeitId !== null && reihenfolge.has(bisMahlzeitId)
      ? reihenfolge.get(bisMahlzeitId)!
      : Number.POSITIVE_INFINITY;
  const imRahmen = (mahlzeitId: number) => (reihenfolge.get(mahlzeitId) ?? 0) <= bis;
  const offen = nurOffene(stand);
  const mahlzeiten = new Map(stand.tage.flatMap((t) => t.mahlzeiten).map((m) => [m.id, m]));
  const gerichte = new Map(stand.gerichte.map((g) => [g.id, g]));
  const abtropf = new Map(stand.zutaten.map((z) => [z.id, z.abtropfgewicht]));

  const ergebnis = new Map<number, PostenHerkunft>();
  const von = (id: number): PostenHerkunft => {
    const vorhanden = ergebnis.get(id);
    if (vorhanden) return vorhanden;
    const neu: PostenHerkunft = { gerichte: [], zusatz: [] };
    ergebnis.set(id, neu);
    return neu;
  };

  /** Lines by planned dish and ingredient, in the order of the plan. */
  const zeilen = new Map<
    string,
    {
      planungZutatId: number;
      mahlzeitId: number;
      einplanungId: number;
      gerichtId: number;
      mengen: Parameters<typeof summiere>[0];
    }
  >();
  const zeile = (z: {
    planungZutatId: number;
    mahlzeitId: number;
    einplanungId: number;
    gerichtId: number;
  }) => {
    const key = `${z.einplanungId}:${z.planungZutatId}`;
    const vorhanden = zeilen.get(key);
    if (vorhanden) return vorhanden;
    const neu = { ...z, mengen: [] };
    zeilen.set(key, neu);
    return neu;
  };
  for (const b of bedarf(offen)) {
    if (imRahmen(b.mahlzeitId)) zeile(b).mengen.push(b);
  }
  for (const z of ohneMengeZeilen(offen)) {
    if (imRahmen(z.mahlzeitId)) zeile(z);
  }
  const position = (z: { mahlzeitId: number; einplanungId: number }) => {
    const mahlzeit = mahlzeiten.get(z.mahlzeitId);
    return [
      reihenfolge.get(z.mahlzeitId) ?? 0,
      mahlzeit?.einplanungen.findIndex((e) => e.id === z.einplanungId) ?? 0,
    ];
  };
  const sortiert = [...zeilen.values()].sort((a, b) => {
    const [ma, ea] = position(a);
    const [mb, eb] = position(b);
    return ma - mb || ea - eb;
  });
  for (const z of sortiert) {
    const mahlzeit = mahlzeiten.get(z.mahlzeitId);
    const gericht = gerichte.get(z.gerichtId);
    if (!mahlzeit || !gericht) continue;
    const summen = summiere(z.mengen).filter((s) => s.menge > 1e-9);
    von(z.planungZutatId).gerichte.push({
      einplanungId: z.einplanungId,
      mahlzeitId: z.mahlzeitId,
      gerichtId: z.gerichtId,
      name: gericht.name,
      // As `einplanungKennung`: the place of the dish in its meal, cooked ones counted too
      kennung: `${mahlzeit.kennung}_${mahlzeit.einplanungen.findIndex((e) => e.id === z.einplanungId) + 1}`,
      menge: summen.length
        ? summen
            .map((s) => kochMenge(s.menge, s.einheit, abtropf.get(z.planungZutatId)))
            .join(' + ')
        : null,
    });
  }
  for (const posten of stand.zusatzbedarf) {
    von(posten.planungZutatId).zusatz.push({
      id: posten.id,
      menge: mengeText(posten.menge, posten.einheit, abtropf.get(posten.planungZutatId)),
      hinweis: posten.hinweis,
    });
  }
  return ergebnis;
}

/** „Chili (1_2_1) 2,5 kg“, then „Zusatzbedarf 2 Packung (für die Küche)“; for text and paper. */
export function herkunftTexte(posten: PostenHerkunft | undefined): string[] {
  if (!posten) return [];
  return [
    ...posten.gerichte.map((g) => [`${g.name} (${g.kennung})`, g.menge ?? 'nach Gefühl'].join(' ')),
    ...posten.zusatz.map((z) =>
      ['Zusatzbedarf', z.menge, z.hinweis ? `(${z.hinweis})` : ''].filter(Boolean).join(' ')
    ),
  ];
}
