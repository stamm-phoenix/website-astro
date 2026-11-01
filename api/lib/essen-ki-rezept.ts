import { z } from 'zod';
import type { EssenEinheitenart } from './essen-validation';
import type { EssenKatalog, GerichtEinheit, PlanungZutat } from './essen-gerichte-model';
import {
  EINHEITEN_JE_ART,
  MAX_EINHEIT,
  MAX_ZEILEN_PRO_GERICHT,
  einheitSchluessel,
  istBekannteEinheit,
  normalisiereEinheit,
} from './essen-gerichte-model';
import type { KiRezept, KiRezeptEinheit, KiRezeptZeile, KiZutatWahl } from './essen-ki-model';
import { KI_REZEPT_EINHEITEN, MAX_MENGE, kiText, kiZahl, runde } from './essen-ki-model';

/**
 * Reading a recipe with the AI (`docs/essensplanung.md`, „KI“): the ingredients the model may
 * choose from, and how its lines are mapped onto them, converted and scaled. Without database or
 * network, so the mock API uses it too.
 */

/** An ingredient the model may map a recipe line to, with what converting needs. */
export interface RezeptKandidat {
  key: string;
  wahl: KiZutatWahl;
  name: string;
  einheitenart: EssenEinheitenart;
  vegetarisch: boolean | null;
  vegan: boolean | null;
  grammProTl: number | null;
  grammProEl: number | null;
  grammProStueck: number | null;
  /** Amounts are drained weight (tins, jars): a filled weight does not count. */
  abtropfgewicht: boolean;
}

/**
 * The food a recipe line may become: the Planung's own ingredients (`p<id>`) and the central list
 * (`z<id>`), each central one once.
 */
export function rezeptKandidaten(
  katalog: EssenKatalog,
  zutaten: readonly PlanungZutat[]
): RezeptKandidat[] {
  const zentral = new Map(katalog.zutaten.map((zutat) => [zutat.id, zutat]));
  const genutzt = new Set(zutaten.map((zutat) => zutat.zutatId));
  return [
    ...zutaten
      .filter((zutat) => zutat.lebensmittel)
      .map((zutat): RezeptKandidat => {
        const liste = zutat.zutatId === null ? undefined : zentral.get(zutat.zutatId);
        return {
          key: `p${zutat.id}`,
          wahl: { planungZutatId: zutat.id },
          name: zutat.name,
          einheitenart: zutat.einheitenart,
          vegetarisch: zutat.vegetarisch,
          vegan: zutat.vegan,
          grammProTl: liste?.grammProTl ?? null,
          grammProEl: liste?.grammProEl ?? null,
          grammProStueck: liste?.grammProStueck ?? null,
          abtropfgewicht: zutat.abtropfgewicht,
        };
      }),
    ...katalog.zutaten
      .filter((zutat) => zutat.lebensmittel && !genutzt.has(zutat.id))
      .map((zutat): RezeptKandidat => ({
        key: `z${zutat.id}`,
        wahl: { zutatId: zutat.id },
        name: zutat.name,
        einheitenart: zutat.einheitenart,
        vegetarisch: zutat.vegetarisch,
        vegan: zutat.vegan,
        grammProTl: zutat.grammProTl,
        grammProEl: zutat.grammProEl,
        grammProStueck: zutat.grammProStueck,
        abtropfgewicht: zutat.abtropfgewicht,
      })),
  ];
}

const rezeptSchema = z.object({
  rezeptPersonen: z.preprocess(
    (value) =>
      typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2000
        ? value
        : null,
    z.number().nullable()
  ),
  zeilen: z.array(z.unknown()),
});

const rezeptZeileSchema = z.object({
  original: kiText(200),
  name: kiText(150).refine((value) => value !== ''),
  key: z.preprocess((value) => (typeof value === 'string' ? value : null), z.string().nullable()),
  menge: kiZahl,
  einheit: z.preprocess(
    (value) => (KI_REZEPT_EINHEITEN.some((unit) => unit === value) ? value : null),
    z.enum(KI_REZEPT_EINHEITEN).nullable()
  ),
  /** The unit word as the recipe writes it, e.g. „Dose“ or „Zehe“; empty for none. */
  einheitRezept: kiText(40).optional(),
  hinweis: kiText(100),
  inhaltMenge: kiZahl.optional(),
  inhaltEinheit: z.preprocess(
    (value) => (['g', 'kg', 'ml', 'l'].includes(value as string) ? value : null),
    z.enum(['g', 'kg', 'ml', 'l']).nullable()
  ),
});

/** What a tin, cup, pack or piece holds, by weight or volume, e.g. „Dose (400 g)“. */
interface Inhalt {
  menge: number;
  einheit: 'g' | 'kg' | 'ml' | 'l';
}

const INHALT_KLAMMER = /\((?:[^()]*?\s)?(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)\s*\)/i;
const INHALT_HINWEIS = /(?:^|[\s,(])(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)\b/i;

/**
 * The content of one tin, pack or piece the line names besides its count: what the model read,
 * else a weight or volume in brackets of the recipe line („1 Dose Tomaten (400 g)“) or in the
 * note („gehackt, 400 g“).
 */
function inhaltVon(zeile: {
  original: string;
  hinweis: string;
  inhaltMenge?: number | null;
  inhaltEinheit: Inhalt['einheit'] | null;
}): Inhalt | null {
  if (zeile.inhaltMenge && zeile.inhaltEinheit)
    return { menge: zeile.inhaltMenge, einheit: zeile.inhaltEinheit };
  const treffer = INHALT_KLAMMER.exec(zeile.original) ?? INHALT_HINWEIS.exec(zeile.hinweis);
  if (!treffer) return null;
  const menge = Number(treffer[1].replace(',', '.'));
  return menge > 0 ? { menge, einheit: treffer[2].toLowerCase() as Inhalt['einheit'] } : null;
}

const ABGETROPFT = /(?:abtropfgewicht|abgetropft)\s*:?\s*(?:ca\.\s*)?(\d+(?:[.,]\d+)?)\s*(g|kg)\b/i;

/** A drained weight the recipe names expressly („Abtropfgewicht 240 g“, „abgetropft 240 g“). */
function abgetropftVon(zeile: { original: string; hinweis: string }): Inhalt | null {
  const treffer = ABGETROPFT.exec(zeile.original) ?? ABGETROPFT.exec(zeile.hinweis);
  if (!treffer) return null;
  const menge = Number(treffer[1].replace(',', '.'));
  return menge > 0 ? { menge, einheit: treffer[2].toLowerCase() as Inhalt['einheit'] } : null;
}

const ZAHL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });
const REZEPT_EINHEIT_TEXT: Record<KiRezeptEinheit, string> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  stueck: 'Stück',
  packung: 'Packung',
  bund: 'Bund',
  tl: 'TL',
  el: 'EL',
  prise: 'Prise',
};
/** Millilitres of a level TL and EL, for ingredients measured by volume. */
const ML_PRO = { tl: 5, el: 15 } as const;

/** Whether a unit is one of the ingredient's kind of unit, e.g. kg for mass. */
function passt(art: EssenEinheitenart, einheit: string): boolean {
  return EINHEITEN_JE_ART[art].some((bekannt) => bekannt === einheit);
}

/**
 * The recipe's unit as a unit of a line: a known one as it is, TL and EL as „TL“ and „EL“, and
 * for tins, cups or cloves the word of the recipe („Dose“, „Zehe“). null for none and for a
 * pinch, which stays by eye.
 */
function rezeptEinheit(einheit: KiRezeptEinheit | null, wort: string | undefined) {
  if (einheit === null || einheit === 'prise') return null;
  const eigene = wort ? normalisiereEinheit(wort) : null;
  if (
    eigene &&
    eigene.length <= MAX_EINHEIT &&
    !istBekannteEinheit(eigene) &&
    ['packung', 'stueck', 'tl', 'el'].includes(einheit)
  )
    return eigene;
  return normalisiereEinheit(REZEPT_EINHEIT_TEXT[einheit]);
}

/** A note with the amount as the recipe wrote it, for a pinch or an amount without a unit. */
function alsHinweis(
  menge: number | null,
  einheit: KiRezeptEinheit | null,
  hinweis: string
): string {
  const angabe =
    menge === null
      ? einheit === 'prise'
        ? 'eine Prise'
        : ''
      : `${ZAHL.format(menge)}${einheit ? ` ${REZEPT_EINHEIT_TEXT[einheit]}` : ''}`;
  return [angabe, hinweis].filter(Boolean).join(', ').slice(0, 100);
}

/**
 * Amount and unit in the ingredient's kind of unit, where the lists know how to get there: TL and
 * EL by weight or volume, pieces by weight, tins by what they hold. null when there is no safe
 * way; the line then keeps the recipe's unit. `eigenesMass` is set when the recipe names a measure
 * of its own for a piece or pack („Scheibe“, „Zehe“, „Dose“): that is no „Stück“ or „Packung“ of
 * the list (2 slices are not 2 loaves), so only an express content converts it.
 */
function umgerechnet(
  menge: number | null,
  einheit: KiRezeptEinheit | null,
  kandidat: RezeptKandidat | undefined,
  inhalt: Inhalt | null = null,
  eigenesMass = false
): { menge: number; einheit: GerichtEinheit } | null {
  if (menge === null || einheit === null || einheit === 'prise') return null;
  // „1 Dose (400 g)“: tins, packs and pieces count by what they hold, if that fits the ingredient
  if (
    inhalt &&
    (einheit === 'packung' || einheit === 'stueck') &&
    (!kandidat || eigenesMass || !passt(kandidat.einheitenart, einheit)) &&
    (!kandidat || passt(kandidat.einheitenart, inhalt.einheit))
  )
    return { menge: menge * inhalt.menge, einheit: inhalt.einheit };
  if (eigenesMass) return null;
  if (!kandidat) {
    return einheit === 'tl' || einheit === 'el' ? null : { menge, einheit };
  }
  const art = kandidat.einheitenart;
  if (einheit !== 'tl' && einheit !== 'el') {
    if (passt(art, einheit)) return { menge, einheit };
    if (art === 'masse' && einheit === 'stueck' && kandidat.grammProStueck !== null)
      return { menge: menge * kandidat.grammProStueck, einheit: 'g' };
    return null;
  }
  if (art === 'volumen') return { menge: menge * ML_PRO[einheit], einheit: 'ml' };
  const gramm = einheit === 'tl' ? kandidat.grammProTl : kandidat.grammProEl;
  if (art === 'masse' && gramm !== null) return { menge: menge * gramm, einheit: 'g' };
  return null;
}

/** Finds the ingredient by its name, ignoring case but not umlauts. */
function nachName(kandidaten: readonly RezeptKandidat[], name: string): RezeptKandidat | undefined {
  return kandidaten.find(
    (kandidat) => kandidat.name.localeCompare(name, 'de', { sensitivity: 'accent' }) === 0
  );
}

/**
 * Reads the lines of a recipe from the model's answer and maps them onto the ingredient lists:
 * the model's choice if it names one of `kandidaten`, else the same name, else none (the page
 * marks it). Amounts are converted into the ingredient's unit where the lists know how (TL and
 * EL by weight or volume, pieces by weight) and scaled from the recipe's people to `personen`;
 * the recipe's own amount stays as `rezeptMenge` to keep instead. What cannot be converted keeps
 * the recipe's unit („3 Bund“); only a pinch stays a note, by eye.
 */
export function leseKiRezept(
  raw: unknown,
  kandidaten: readonly RezeptKandidat[],
  personen: number | null
): KiRezept {
  const antwort = rezeptSchema.safeParse(raw);
  if (!antwort.success) throw new Error('Invalid answer of the recipe');
  const nachKey = new Map(kandidaten.map((kandidat) => [kandidat.key, kandidat]));
  const { rezeptPersonen } = antwort.data;
  // A dish without people takes the amounts as written; the page offers the recipe's number
  const faktor = rezeptPersonen && personen ? personen / rezeptPersonen : 1;
  const skaliert = (menge: { menge: number; einheit: GerichtEinheit }) => ({
    menge: runde(Math.min(menge.menge * faktor, MAX_MENGE), menge.einheit),
    einheit: menge.einheit,
  });
  const zeilen: KiRezeptZeile[] = [];
  for (const value of antwort.data.zeilen) {
    if (zeilen.length >= MAX_ZEILEN_PRO_GERICHT) break;
    const eintrag = rezeptZeileSchema.safeParse(value);
    if (!eintrag.success) continue;
    const zeile = eintrag.data;
    const kandidat =
      (zeile.key === null ? undefined : nachKey.get(zeile.key)) ?? nachName(kandidaten, zeile.name);
    const inhalt = inhaltVon(zeile);
    const abgetropft = abgetropftVon(zeile);
    // Tins of an ingredient counted by drained weight: the filled weight („Dose (400 g)“) is
    // not the amount; only an express drained weight is, else the tins are counted
    const eigene = rezeptEinheit(zeile.einheit, zeile.einheitRezept);
    // The recipe names a measure of its own for a piece or pack („2 Scheiben“, „1 Zehe“): no
    // „Stück“ of the list, which may mean a whole loaf or bulb
    const eigenesMass =
      (zeile.einheit === 'packung' || zeile.einheit === 'stueck') &&
      eigene !== null &&
      !istBekannteEinheit(eigene);
    const zaehltInhalt =
      (zeile.einheit === 'packung' || zeile.einheit === 'stueck') &&
      kandidat !== undefined &&
      (eigenesMass || !passt(kandidat.einheitenart, zeile.einheit));
    const ohneAbtropfgewicht =
      zaehltInhalt && kandidat.abtropfgewicht && inhalt !== null && abgetropft === null;
    const umgerechnetMenge = ohneAbtropfgewicht
      ? null
      : umgerechnet(
          zeile.menge,
          zeile.einheit,
          kandidat,
          kandidat?.abtropfgewicht ? abgetropft : (abgetropft ?? inhalt),
          eigenesMass
        );
    const rezeptMenge =
      zeile.menge !== null && eigene ? { menge: zeile.menge, einheit: eigene } : null;
    // Never given up: without a safe conversion the line keeps the recipe's unit
    const menge = umgerechnetMenge ?? rezeptMenge;
    const anders =
      umgerechnetMenge !== null &&
      rezeptMenge !== null &&
      einheitSchluessel(umgerechnetMenge.einheit) !== einheitSchluessel(rezeptMenge.einheit);
    // What one tin holds stays readable next to the count of tins
    const fuellung =
      ohneAbtropfgewicht && !INHALT_HINWEIS.test(zeile.hinweis)
        ? `à ${ZAHL.format(inhalt.menge)} ${inhalt.einheit}`
        : '';
    zeilen.push({
      original: zeile.original || zeile.name,
      name: zeile.name,
      zutat: kandidat?.wahl ?? null,
      menge: menge ? skaliert(menge).menge : null,
      einheit: menge?.einheit ?? null,
      hinweis: menge
        ? [fuellung, zeile.hinweis].filter(Boolean).join(', ').slice(0, 100)
        : alsHinweis(zeile.menge, zeile.einheit, zeile.hinweis),
      rezeptMenge: anders ? skaliert(rezeptMenge) : null,
      fuerAlles: true,
      // Meat for those who eat everything only; unknown properties leave the line for all
      fuerVegetarisch: kandidat?.vegetarisch !== false,
      fuerVegan: kandidat?.vegan !== false,
    });
  }
  return { rezeptPersonen, personen, zeilen };
}
