import { essenKatalog } from './essensplanung';
import { MockKiBesetzt, FEHLER, pruefeZugang } from './essensplanung-ki';
import type { MockZugang } from './essensplanung-planung';
import { aendere, neuesEtag } from './essensplanung-planung';

/**
 * „Angaben ergänzen“ of the demo AI (`zutatenErgaenzen` in `api/lib/essen-ki-zutaten.ts`): fixed
 * answers by the name. Meat and fish words are „mit Fleisch“, dairy and egg words vegetarian with
 * lactose or egg, everything else vegan; the category is the first whose name fits, the kind of
 * unit stays or becomes grams. „KI-Fehler“ in a name answers 429.
 */

const FLEISCH = /fleisch|hack|wurst|speck|schinken|salami|fisch|lachs|thunfisch|huhn|hähnchen/i;
const MILCH = /käse|milch|sahne|butter|quark|joghurt|schmand|mozzarella|feta/i;
const EI = /\bei(er)?\b|eier/i;
const MEHL = /mehl|nudel|brot|brötchen|teig|grieß/i;

function kategorieFuer(name: string): number | null {
  const kategorien = essenKatalog().kategorien;
  const passt = (wort: RegExp) => kategorien.find((k) => wort.test(k.name))?.id;
  if (FLEISCH.test(name)) return passt(/^fleisch/i) ?? null;
  if (MILCH.test(name) || EI.test(name)) return passt(/^milchprodukt$/i) ?? null;
  return passt(/^gemüse$/i) ?? null;
}

function allergeneFuer(name: string): number[] {
  const liste = essenKatalog().unvertraeglichkeiten;
  const id = (wort: RegExp) => liste.find((u) => wort.test(u.name))?.id;
  return [
    MILCH.test(name) ? id(/laktose|milch/i) : undefined,
    EI.test(name) ? id(/^ei/i) : undefined,
    MEHL.test(name) ? id(/gluten/i) : undefined,
  ].filter((wert): wert is number => wert !== undefined);
}

export function kiZutatenErgaenzen(z: MockZugang, wartung: boolean): { ergaenzt: string[] } {
  pruefeZugang(z, wartung);
  const offen = z.planung.zutaten.filter((zutat) => zutat.angabenOffen?.length).slice(0, 25);
  if (offen.some((zutat) => FEHLER.test(zutat.name ?? ''))) throw new MockKiBesetzt();
  if (!offen.length) return { ergaenzt: [] };
  const ergaenzt = offen.map((zutat) => zutat.name ?? '');
  aendere(z, 'zutat-ki', { namen: ergaenzt }, () => {
    for (const zutat of offen) {
      const name = zutat.name ?? '';
      const angaben = zutat.angabenOffen ?? [];
      if (angaben.includes('kategorie'))
        zutat.kategorieId = kategorieFuer(name) ?? zutat.kategorieId;
      if (angaben.includes('einheitenart')) zutat.einheitenart = 'masse';
      if (angaben.includes('merkmale')) {
        const fleisch = FLEISCH.test(name);
        const tierisch = MILCH.test(name) || EI.test(name);
        zutat.vegetarisch = !fleisch;
        zutat.vegan = !fleisch && !tierisch;
        zutat.allergene = allergeneFuer(name);
      }
      zutat.angabenOffen = undefined;
      zutat.etag = neuesEtag();
    }
  });
  return { ergaenzt };
}
