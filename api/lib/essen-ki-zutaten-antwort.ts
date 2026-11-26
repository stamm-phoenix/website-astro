import { z } from 'zod';
import type { EssenEinheitenart } from './essen-schema';
import { EINHEITENARTEN } from './essen-schema';
import type { PlanungZutat } from './essen-gerichte-model';
import { kiText } from './essen-ki-model';
import type { EssenZutat } from './essen-validation';
import { MAX_KI_ZUTATEN } from './essen-ki-zutaten-model';
import { ValidationError } from './validation/errors';
import type {
  KiZutatAenderung,
  KiZutatErgebnis,
  KiZutatPruefung,
  KiZutatWerte,
} from './essen-ki-zutaten-model';

/**
 * Reading the AI's check of ingredients (`essen-ki-zutaten.ts`). Without database or network, so
 * the mock API uses it too. The AI answers the whole set of values per ingredient; what differs
 * from the stored values becomes the proposal. Every ingredient asked about gets a result, also
 * one the AI did not understand or left out.
 */

/** An ingredient as it is asked about. */
export interface KiZutatEingabe {
  /** Key in the question and the answer, e.g. „z12“. */
  schluessel: string;
  id: number;
  etag: string;
  werte: KiZutatWerte;
  /** Central ingredients have the conversion help and can be no food. */
  zentral: boolean;
  /** An own one whose category and kind of unit were guessed: confirming them is a proposal too. */
  angabenOffen?: boolean;
}

/** The lists names in the question and answer stand for. */
export interface KiZutatListen {
  kategorien: readonly { id: number; name: string }[];
  unvertraeglichkeiten: readonly { id: number; name: string }[];
}

const GRENZE = { grammProTl: 1000, grammProEl: 1000, grammProStueck: 100_000 } as const;

const EINHEITENART_TEXT: Record<EssenEinheitenart, string> = {
  masse: 'Gewicht (g/kg)',
  volumen: 'Volumen (ml/l)',
  stueck: 'Stück',
  packung: 'Packung',
  bund: 'Bund',
};

const flag = z.preprocess(
  (value) => (typeof value === 'boolean' ? value : null),
  z.boolean().nullable()
);

const gramm = z.preprocess(
  (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null),
  z.number().nullable()
);

const eintragSchema = z.object({
  schluessel: kiText(20),
  verstanden: z.boolean().catch(true),
  grund: kiText(300).catch(''),
  name: kiText(150).catch(''),
  kategorie: kiText(100).nullable().catch(null),
  einheitenart: z.enum(EINHEITENARTEN).nullable().catch(null),
  lebensmittel: flag,
  vegetarisch: flag,
  vegan: flag,
  allergene: z.array(z.unknown()).nullable().catch(null),
  gramm_pro_tl: gramm,
  gramm_pro_el: gramm,
  gramm_pro_stueck: gramm,
  begruendung: kiText(300).catch(''),
});

const antwortSchema = z.object({ zutaten: z.array(z.unknown()) });

const klein = (text: string) => text.toLocaleLowerCase('de').trim();

function ernaehrungText(werte: Pick<KiZutatWerte, 'vegetarisch' | 'vegan'>): string {
  if (werte.vegan) return 'vegan';
  if (werte.vegetarisch) return 'vegetarisch';
  if (werte.vegetarisch === false) return 'mit Fleisch oder Fisch';
  return 'unbekannt';
}

const zahlText = (wert: number | null) =>
  wert === null ? 'leer' : `${wert.toLocaleString('de-DE')} g`;

/**
 * A conversion value the AI proposes: rounded like the Steuerung stores it, kept when the stored
 * one is near (within a half), dropped when out of range.
 */
function grammVorschlag(
  alt: number | null,
  neu: number | null,
  feld: keyof typeof GRENZE
): number | null {
  if (neu === null || neu > GRENZE[feld]) return alt;
  const gerundet = neu < 10 ? Math.round(neu * 10) / 10 : Math.round(neu);
  if (gerundet < 0.1) return alt;
  if (alt !== null && Math.abs(gerundet - alt) <= alt * 0.5) return alt;
  return gerundet;
}

/** The values after the AI's answer: what it says, where it says something usable. */
function neueWerte(
  eingabe: KiZutatEingabe,
  antwort: z.output<typeof eintragSchema>,
  listen: KiZutatListen
): KiZutatWerte {
  const alt = eingabe.werte;
  const kategorie = antwort.kategorie
    ? listen.kategorien.find((k) => klein(k.name) === klein(antwort.kategorie!))
    : undefined;
  const lebensmittel = eingabe.zentral
    ? (antwort.lebensmittel ?? alt.lebensmittel)
    : alt.lebensmittel;
  const vegan = antwort.vegan ?? alt.vegan;
  // Vegan includes vegetarian
  const vegetarisch = vegan ? true : (antwort.vegetarisch ?? alt.vegetarisch);
  const allergene =
    antwort.allergene === null
      ? alt.allergene
      : [
          ...new Set(
            antwort.allergene.flatMap((wert) => {
              const name = typeof wert === 'string' ? klein(wert) : '';
              const treffer = listen.unvertraeglichkeiten.find((u) => klein(u.name) === name);
              return treffer ? [treffer.id] : [];
            })
          ),
        ].sort((a, b) => a - b);
  const einheitenart = antwort.einheitenart ?? alt.einheitenart;
  // The conversion help is only for central food weighed in g/kg
  const umrechnen = eingabe.zentral && lebensmittel && einheitenart === 'masse';
  return {
    name: antwort.name && antwort.name.length <= 150 ? antwort.name : alt.name,
    kategorieId: kategorie?.id ?? alt.kategorieId,
    einheitenart,
    lebensmittel,
    // Things that are not eaten have no diet and no allergens
    vegetarisch: lebensmittel ? vegetarisch : null,
    vegan: lebensmittel ? (vegetarisch === false ? false : vegan) : null,
    allergene: lebensmittel ? allergene : [],
    grammProTl: umrechnen
      ? grammVorschlag(alt.grammProTl, antwort.gramm_pro_tl, 'grammProTl')
      : alt.grammProTl,
    grammProEl: umrechnen
      ? grammVorschlag(alt.grammProEl, antwort.gramm_pro_el, 'grammProEl')
      : alt.grammProEl,
    grammProStueck: umrechnen
      ? grammVorschlag(alt.grammProStueck, antwort.gramm_pro_stueck, 'grammProStueck')
      : alt.grammProStueck,
  };
}

/** What differs between the stored values and the proposal, in the words of the page. */
export function kiZutatAenderungen(
  alt: KiZutatWerte,
  neu: KiZutatWerte,
  listen: KiZutatListen
): KiZutatAenderung[] {
  const kategorie = (id: number) => listen.kategorien.find((k) => k.id === id)?.name ?? '?';
  const allergene = (ids: number[]) =>
    ids.length
      ? ids
          .map((id) => listen.unvertraeglichkeiten.find((u) => u.id === id)?.name ?? '?')
          .join(', ')
      : 'keine';
  const aenderungen: KiZutatAenderung[] = [];
  const add = (feld: KiZutatAenderung['feld'], label: string, a: string, b: string) => {
    if (a !== b) aenderungen.push({ feld, label, alt: a, neu: b });
  };
  add('name', 'Name', alt.name, neu.name);
  add('kategorie', 'Kategorie', kategorie(alt.kategorieId), kategorie(neu.kategorieId));
  add(
    'einheitenart',
    'Gemessen in',
    EINHEITENART_TEXT[alt.einheitenart],
    EINHEITENART_TEXT[neu.einheitenart]
  );
  add(
    'lebensmittel',
    'Lebensmittel',
    alt.lebensmittel ? 'ja' : 'nein',
    neu.lebensmittel ? 'ja' : 'nein'
  );
  if (neu.lebensmittel) {
    add('ernaehrung', 'Ernährung', ernaehrungText(alt), ernaehrungText(neu));
    add('allergene', 'Enthält', allergene(alt.allergene), allergene(neu.allergene));
  }
  add('grammProTl', 'Gramm pro TL', zahlText(alt.grammProTl), zahlText(neu.grammProTl));
  add('grammProEl', 'Gramm pro EL', zahlText(alt.grammProEl), zahlText(neu.grammProEl));
  add(
    'grammProStueck',
    'Gramm pro Stück',
    zahlText(alt.grammProStueck),
    zahlText(neu.grammProStueck)
  );
  return aenderungen;
}

const UNKLAR =
  'Die KI weiß nicht, was mit diesem Namen gemeint ist. Schreib ihn eindeutiger, z. B. „Paprika rot“ statt „rote Dinger“.';
const OHNE_ANTWORT = 'Die KI hat zu dieser Zutat nichts gesagt. Prüf sie noch einmal einzeln.';

/** Reads the answer: one result per ingredient asked about, in the order asked. */
export function leseKiZutaten(
  raw: unknown,
  eingaben: readonly KiZutatEingabe[],
  listen: KiZutatListen
): KiZutatPruefung {
  const antwort = antwortSchema.safeParse(raw);
  if (!antwort.success) throw new Error('Invalid answer of the ingredient check');
  const eintraege = new Map<string, z.output<typeof eintragSchema>>();
  for (const value of antwort.data.zutaten) {
    const eintrag = eintragSchema.safeParse(value);
    if (eintrag.success && !eintraege.has(eintrag.data.schluessel))
      eintraege.set(eintrag.data.schluessel, eintrag.data);
  }
  return {
    ergebnisse: eingaben.map((eingabe): KiZutatErgebnis => {
      const basis = { id: eingabe.id, etag: eingabe.etag, name: eingabe.werte.name };
      const eintrag = eintraege.get(eingabe.schluessel);
      if (!eintrag)
        return {
          ...basis,
          status: 'ohne_antwort',
          text: OHNE_ANTWORT,
          aenderungen: [],
          vorschlag: null,
        };
      if (!eintrag.verstanden)
        return {
          ...basis,
          status: 'unklar',
          text: eintrag.grund || UNKLAR,
          aenderungen: [],
          vorschlag: null,
        };
      const vorschlag = neueWerte(eingabe, eintrag, listen);
      const aenderungen = kiZutatAenderungen(eingabe.werte, vorschlag, listen);
      // Guessed details the AI confirms are taken over too, which clears „Angaben fehlen“
      if (!aenderungen.length && eingabe.angabenOffen)
        aenderungen.push({ feld: 'kategorie', label: 'Angaben', alt: 'geraten', neu: 'bestätigt' });
      return aenderungen.length
        ? { ...basis, status: 'vorschlag', text: eintrag.begruendung, aenderungen, vorschlag }
        : { ...basis, status: 'passt', text: '', aenderungen: [], vorschlag: null };
    }),
  };
}

/** An own ingredient of a Planung as it is asked about. */
export function kiEingabeDerPlanung(zutat: PlanungZutat): KiZutatEingabe {
  return {
    schluessel: `p${zutat.id}`,
    id: zutat.id,
    etag: zutat.etag,
    zentral: false,
    angabenOffen: zutat.angabenOffen,
    werte: {
      name: zutat.name,
      kategorieId: zutat.kategorieId,
      einheitenart: zutat.einheitenart,
      lebensmittel: zutat.lebensmittel,
      vegetarisch: zutat.vegetarisch,
      vegan: zutat.vegan,
      allergene: [...zutat.allergene],
      grammProTl: null,
      grammProEl: null,
      grammProStueck: null,
    },
  };
}

/** A central ingredient as it is asked about. */
export function kiEingabeZentral(zutat: EssenZutat): KiZutatEingabe {
  return {
    schluessel: `z${zutat.id}`,
    id: zutat.id,
    etag: zutat.etag,
    zentral: true,
    werte: {
      name: zutat.name,
      kategorieId: zutat.kategorieId,
      einheitenart: zutat.einheitenart,
      lebensmittel: zutat.lebensmittel,
      vegetarisch: zutat.vegetarisch,
      vegan: zutat.vegan,
      allergene: [...zutat.allergene],
      grammProTl: zutat.grammProTl,
      grammProEl: zutat.grammProEl,
      grammProStueck: zutat.grammProStueck,
    },
  };
}

/**
 * The data the model sees: per ingredient its key and values, with names for categories and
 * allergens. `offen` names the keys whose category and kind of unit are guesses.
 */
export function kiZutatenAnfrage(
  eingaben: readonly KiZutatEingabe[],
  listen: KiZutatListen,
  offen: ReadonlySet<string> = new Set()
) {
  const kategorie = (id: number) => listen.kategorien.find((k) => k.id === id)?.name ?? null;
  const allergen = (id: number) => listen.unvertraeglichkeiten.find((u) => u.id === id)?.name;
  return {
    kategorien: listen.kategorien.map((k) => k.name),
    allergene: listen.unvertraeglichkeiten.map((u) => u.name),
    zutaten: eingaben.map(({ schluessel, werte, zentral }) => ({
      schluessel,
      name: werte.name,
      angaben_offen: offen.has(schluessel),
      kategorie: offen.has(schluessel) ? null : kategorie(werte.kategorieId),
      einheitenart: werte.einheitenart,
      lebensmittel: werte.lebensmittel,
      vegetarisch: werte.vegetarisch,
      vegan: werte.vegan,
      allergene: werte.allergene.map(allergen).filter(Boolean),
      ...(zentral
        ? {
            gramm_pro_tl: werte.grammProTl,
            gramm_pro_el: werte.grammProEl,
            gramm_pro_stueck: werte.grammProStueck,
          }
        : {}),
    })),
  };
}

/** The ids sent by the page: 1 to `MAX_KI_ZUTATEN` positive whole numbers, each once. */
export function readKiZutatIds(body: Record<string, unknown> | null): number[] {
  const ids = body?.ids;
  const fehler = new ValidationError({ ids: 'Bitte Zutaten zum Prüfen wählen.' });
  if (!Array.isArray(ids) || !ids.length) throw fehler;
  if (ids.length > MAX_KI_ZUTATEN)
    throw new ValidationError({ ids: `Höchstens ${MAX_KI_ZUTATEN} Zutaten auf einmal.` });
  if (!ids.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)) throw fehler;
  return [...new Set(ids as number[])];
}
