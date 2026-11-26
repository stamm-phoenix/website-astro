import { z } from 'zod';
import type { Gericht, GerichtEinheit, GerichtZutat, PlanungZutat } from './essen-gerichte-model';
import {
  EINHEITEN_JE_ART,
  MAX_WERKZEUGE,
  einheitSchluessel,
  istBekannteEinheit,
} from './essen-gerichte-model';
import { MAX_HINWEISE, MAX_TEXT, kiText, kiZahl } from './essen-ki-model';
import type {
  KiAenderung,
  KiHinweis,
  KiNeueZeile,
  KiPersonenQuelle,
  KiPruefung,
  KiWerkzeugAenderung,
  KiZutatAngabe,
} from './essen-ki-pruefen-model';
import { KI_HINWEIS_ARTEN } from './essen-ki-pruefen-model';
import type { RezeptKandidat } from './essen-ki-rezept';
import { nachName, passt } from './essen-ki-rezept';
import type { EssenEinheitenart } from './essen-validation';

/**
 * Reading the answer of „Gericht prüfen (KI)“ (`docs/essensplanung.md`, „KI“): the assessment
 * and the hints, each with at most one change the page can take over. Every change is checked
 * against the dish as it was sent: a line or tool that is not there, a unit that does not fit
 * the ingredient or a line for no diet leaves the hint without a change. Without database or
 * network, so the mock API uses it too.
 */

/** What a hint may do; the model names one per hint. */
export const KI_AKTIONEN = [
  'keine',
  'zeile_aendern',
  'zeile_entfernen',
  'zutat_hinzufuegen',
  'werkzeug_hinzufuegen',
  'werkzeug_aendern',
  'werkzeug_entfernen',
] as const;

/** The units a line of a dish may get from the AI. */
export const KI_ZEILEN_EINHEITEN = [...new Set(Object.values(EINHEITEN_JE_ART).flat())];

/** As long as the assessment may be; the model is asked for a few sentences. */
export const MAX_EINSCHAETZUNG = 2000;
/** As long as a note of a line or a tool may be (`essen-gerichte-schema.ts`). */
const MAX_ZEILEN_HINWEIS = 100;
const MAX_WERKZEUG = 100;

const flag = z.preprocess(
  (value) => (typeof value === 'boolean' ? value : null),
  z.boolean().nullable()
);

/** A text of one line or null, cut at `max`; empty is null. */
const kiTextOderNull = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : null),
    z
      .string()
      .nullable()
      .transform((value) => (value ? value.slice(0, max) : null))
  );

const antwortSchema = z.object({
  einschaetzung: z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .replace(/\r\n?/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
        : '',
    z.string().transform((value) => value.slice(0, MAX_EINSCHAETZUNG))
  ),
  hinweise: z.array(z.unknown()),
});

const hinweisSchema = z.object({
  art: z.preprocess(
    (value) => (KI_HINWEIS_ARTEN.some((art) => art === value) ? value : 'sonstiges'),
    z.enum(KI_HINWEIS_ARTEN)
  ),
  aktion: z.preprocess(
    (value) => (KI_AKTIONEN.some((aktion) => aktion === value) ? value : null),
    z.enum(KI_AKTIONEN).nullable()
  ),
  zeile: z.preprocess((value) => (Number.isInteger(value) ? value : null), z.number().nullable()),
  text: kiText(MAX_TEXT).refine((value) => value !== ''),
  vorschlag: kiText(MAX_TEXT),
  menge: kiZahl,
  einheit: z.preprocess(
    (value) => (typeof value === 'string' && istBekannteEinheit(value) ? value : null),
    z.custom<GerichtEinheit>().nullable()
  ),
  fuerAlles: flag,
  fuerVegetarisch: flag,
  fuerVegan: flag,
  fest: flag,
  // Empty is „unchanged“, as the model has to send every field
  hinweisNeu: kiTextOderNull(MAX_ZEILEN_HINWEIS),
  zutatKey: z.preprocess(
    (value) => (typeof value === 'string' && value ? value : null),
    z.string().nullable()
  ),
  zutatName: kiTextOderNull(150),
  werkzeug: kiTextOderNull(MAX_WERKZEUG),
  werkzeugNeu: kiTextOderNull(MAX_WERKZEUG),
});
type KiRohHinweis = z.infer<typeof hinweisSchema>;

/** Field names of the data the model sees, and how the page says them. */
const FELDNAMEN: [RegExp, string][] = [
  [/\bnichtFuer\b/g, 'nicht bei'],
  [/\bnurFuer\b/g, 'nur bei'],
  [/\bfuerAlles\b/g, 'für alle, die alles essen'],
  [/\bfuerVegetarisch\b/g, 'vegetarisch'],
  [/\bfuerVegan\b/g, 'vegan'],
  [/\beinheitenart\b/g, 'Einheit'],
  [/\benthaelt\b/g, 'enthält'],
  [/\bhinweisNeu\b/g, 'Hinweis'],
  [/\bwerkzeugNeu\b/g, 'neues Werkzeug'],
];
/** Internal ids that say nothing to a person; a text with them is left out. */
const INTERN = /\b(?:planungZutatId|zutatId|zutatKey|gerichtId|etag)\b/;

/**
 * A hint's text in the words of the page: field names the model may echo are replaced; null for
 * a text with internal ids.
 */
export function oberflaechenText(text: string): string | null {
  if (INTERN.test(text)) return null;
  return FELDNAMEN.reduce((ergebnis, [muster, wort]) => ergebnis.replace(muster, wort), text);
}

/** Whether a unit is a known one that does not fit `art`; a unit of its own („Dose“) fits all. */
function passtNicht(einheit: GerichtEinheit, art: EssenEinheitenart | undefined): boolean {
  return art !== undefined && istBekannteEinheit(einheit) && !passt(art, einheit);
}

/** The ingredient the model means: its key, else the same name, else a new one by name. */
function zutatAngabe(
  hinweis: KiRohHinweis,
  nachKey: ReadonlyMap<string, RezeptKandidat>,
  kandidaten: readonly RezeptKandidat[]
): { angabe: KiZutatAngabe; kandidat: RezeptKandidat | undefined } | undefined {
  const kandidat =
    (hinweis.zutatKey === null ? undefined : nachKey.get(hinweis.zutatKey)) ??
    (hinweis.zutatName === null ? undefined : nachName(kandidaten, hinweis.zutatName));
  if (kandidat) return { angabe: { wahl: kandidat.wahl, name: kandidat.name }, kandidat };
  if (hinweis.zutatName === null) return undefined;
  return { angabe: { wahl: null, name: hinweis.zutatName }, kandidat: undefined };
}

/**
 * The change a hint proposes for `zeile`, if it changes anything: a new amount stays in the base
 * unit of the line (or fits the new ingredient), the line stays for at least one diet, and a new
 * ingredient fits the line's unit.
 */
function aenderungFuer(
  hinweis: KiRohHinweis,
  zeile: GerichtZutat,
  art: EssenEinheitenart | undefined,
  neu: { angabe: KiZutatAngabe; kandidat: RezeptKandidat | undefined } | undefined
): KiAenderung | undefined {
  const aenderung: KiAenderung = {};
  const tausch =
    neu &&
    !(
      neu.angabe.wahl &&
      'planungZutatId' in neu.angabe.wahl &&
      neu.angabe.wahl.planungZutatId === zeile.planungZutatId
    )
      ? neu
      : undefined;
  const zielArt = tausch ? tausch.kandidat?.einheitenart : art;
  if (hinweis.menge !== null) {
    const einheit = hinweis.einheit ?? zeile.einheit;
    // A new amount stays in the base unit of the line: 500 ml of pasta is no proposal. With
    // another ingredient it has to fit that one instead.
    const bleibt = tausch
      ? einheit !== null && !passtNicht(einheit, zielArt)
      : einheit !== null && einheitBleibt(einheit, zeile, art);
    if (einheit && bleibt) {
      const menge = Math.round(hinweis.menge * 1000) / 1000 || 0.001;
      if (menge !== zeile.menge || einheit !== zeile.einheit) {
        aenderung.menge = menge;
        aenderung.einheit = einheit;
      }
    } else if (tausch) {
      // An amount for the other ingredient that does not fit it: the swap is no proposal either
      return undefined;
    }
  }
  if (tausch) {
    // The line keeps its amount: its unit must fit the new ingredient, too. Amount, diets and
    // note were meant for the other ingredient: without the swap, the hint changes nothing.
    const einheit = aenderung.einheit ?? zeile.einheit;
    if (einheit !== null && passtNicht(einheit, zielArt)) return undefined;
    aenderung.zutat = tausch.angabe;
  }
  let fuer = {
    fuerAlles: hinweis.fuerAlles ?? zeile.fuerAlles,
    fuerVegetarisch: hinweis.fuerVegetarisch ?? zeile.fuerVegetarisch,
    fuerVegan: hinweis.fuerVegan ?? zeile.fuerVegan,
  };
  // Another ingredient never stays for diets it does not suit, like a line to add; a swap that
  // would leave the line for nobody is dropped with everything meant for it
  if (tausch?.kandidat) {
    const geklemmt = {
      ...fuer,
      fuerVegetarisch: fuer.fuerVegetarisch && tausch.kandidat.vegetarisch !== false,
      fuerVegan: fuer.fuerVegan && tausch.kandidat.vegan !== false,
    };
    if (!geklemmt.fuerAlles && !geklemmt.fuerVegetarisch && !geklemmt.fuerVegan) return undefined;
    fuer = geklemmt;
  }
  // A line must stay for at least one diet
  if (fuer.fuerAlles || fuer.fuerVegetarisch || fuer.fuerVegan) {
    for (const feld of ['fuerAlles', 'fuerVegetarisch', 'fuerVegan'] as const) {
      if (fuer[feld] !== zeile[feld]) aenderung[feld] = fuer[feld];
    }
  }
  if (hinweis.hinweisNeu !== null && hinweis.hinweisNeu !== zeile.hinweis) {
    const text = oberflaechenText(hinweis.hinweisNeu);
    if (text !== null) aenderung.hinweis = text;
  }
  return Object.keys(aenderung).length ? aenderung : undefined;
}

/** Whether a proposed unit fits: the line's base unit, or for a line without one the ingredient's. */
function einheitBleibt(
  einheit: GerichtEinheit,
  zeile: GerichtZutat,
  art: EssenEinheitenart | undefined
): boolean {
  if (zeile.einheit) return einheitSchluessel(einheit) === einheitSchluessel(zeile.einheit);
  return art !== undefined && passt(art, einheit);
}

/**
 * A line to add: an amount only in a unit that fits the ingredient, the diets as the model says
 * but never meat for vegetarians, and for at least one diet.
 */
function neueZeileFuer(
  hinweis: KiRohHinweis,
  neu: { angabe: KiZutatAngabe; kandidat: RezeptKandidat | undefined }
): KiNeueZeile | undefined {
  const { kandidat } = neu;
  const einheit = hinweis.menge === null ? null : hinweis.einheit;
  if (hinweis.menge !== null && (einheit === null || passtNicht(einheit, kandidat?.einheitenart)))
    return undefined;
  const fuerAlles = hinweis.fuerAlles ?? true;
  const fuerVegetarisch = (hinweis.fuerVegetarisch ?? true) && kandidat?.vegetarisch !== false;
  const fuerVegan = (hinweis.fuerVegan ?? true) && kandidat?.vegan !== false;
  if (!fuerAlles && !fuerVegetarisch && !fuerVegan) return undefined;
  const text = hinweis.hinweisNeu === null ? '' : (oberflaechenText(hinweis.hinweisNeu) ?? '');
  return {
    zutat: neu.angabe,
    menge: hinweis.menge === null ? null : Math.round(hinweis.menge * 1000) / 1000 || 0.001,
    einheit,
    fest: hinweis.menge !== null && hinweis.fest === true,
    fuerAlles,
    fuerVegetarisch,
    fuerVegan,
    hinweis: text,
  };
}

/** The tool of the dish the model names, as the dish spells it. */
function werkzeugVon(werkzeuge: readonly string[], name: string | null): string | undefined {
  if (name === null) return undefined;
  return werkzeuge.find((werkzeug) => werkzeug.toLowerCase() === name.toLowerCase());
}

/** A change of the tools that fits the dish: no doubles, at most `MAX_WERKZEUGE`. */
function werkzeugAenderung(
  hinweis: KiRohHinweis,
  werkzeuge: readonly string[]
): KiWerkzeugAenderung | undefined {
  const alt = werkzeugVon(werkzeuge, hinweis.werkzeug);
  const neu = hinweis.werkzeugNeu;
  const gibtEs = neu !== null && werkzeugVon(werkzeuge, neu) !== undefined;
  if (hinweis.aktion === 'werkzeug_hinzufuegen') {
    if (neu === null || gibtEs || werkzeuge.length >= MAX_WERKZEUGE) return undefined;
    return { alt: null, neu };
  }
  if (hinweis.aktion === 'werkzeug_aendern') {
    if (alt === undefined || neu === null || neu === alt) return undefined;
    // Only another spelling of the same tool, or a name no other tool has
    if (gibtEs && neu.toLowerCase() !== alt.toLowerCase()) return undefined;
    return { alt, neu };
  }
  if (hinweis.aktion === 'werkzeug_entfernen' && alt !== undefined) return { alt, neu: null };
  return undefined;
}

/** What the check was done with, besides the dish. */
export interface PruefKontext {
  kandidaten: readonly RezeptKandidat[];
  geprueftFuer: number | null;
  personenQuelle: KiPersonenQuelle | null;
}

/**
 * Reads the assessment and the hints of the model on `gericht`: entries that do not fit are left
 * out, a line number outside the dish counts for the whole dish, and a proposed change only stays
 * when it fits the dish as it was checked. Without `aktion` (older answers), a hint on a line
 * changes that line.
 */
export function leseKiPruefung(
  raw: unknown,
  gericht: Gericht,
  zutaten: ReadonlyMap<number, PlanungZutat>,
  kontext: PruefKontext
): KiPruefung {
  const antwort = antwortSchema.safeParse(raw);
  if (!antwort.success) throw new Error('Invalid answer of the check');
  const nachKey = new Map(kontext.kandidaten.map((kandidat) => [kandidat.key, kandidat]));
  const hinweise: KiHinweis[] = [];
  for (const value of antwort.data.hinweise) {
    if (hinweise.length >= MAX_HINWEISE) break;
    const eintrag = hinweisSchema.safeParse(value);
    if (!eintrag.success) continue;
    const hinweis = eintrag.data;
    const text = oberflaechenText(hinweis.text);
    const vorschlag = oberflaechenText(hinweis.vorschlag);
    if (text === null || vorschlag === null) continue;
    const zeile =
      hinweis.zeile !== null && hinweis.zeile >= 1 ? gericht.zutaten[hinweis.zeile - 1] : undefined;
    const aktion = hinweis.aktion ?? (zeile ? 'zeile_aendern' : 'keine');
    const ergebnis: KiHinweis = {
      art: hinweis.art,
      ...(zeile ? { zeile: { id: zeile.id, etag: zeile.etag } } : {}),
      text,
      vorschlag,
    };
    if (aktion === 'zeile_aendern' && zeile) {
      const art = zutaten.get(zeile.planungZutatId)?.einheitenart;
      const mitTausch = hinweis.zutatKey !== null || hinweis.zutatName !== null;
      const neu = mitTausch ? zutatAngabe(hinweis, nachKey, kontext.kandidaten) : undefined;
      // An invented key without a name: what the hint proposes was meant for an unknown
      // ingredient, so it changes nothing
      const aenderung = mitTausch && !neu ? undefined : aenderungFuer(hinweis, zeile, art, neu);
      if (aenderung) ergebnis.aenderung = aenderung;
    } else if (aktion === 'zeile_entfernen' && zeile) {
      ergebnis.entfernen = true;
    } else if (aktion === 'zutat_hinzufuegen') {
      const neu = zutatAngabe(hinweis, nachKey, kontext.kandidaten);
      const neueZeile = neu && neueZeileFuer(hinweis, neu);
      if (neueZeile) ergebnis.neueZeile = neueZeile;
    } else if (aktion.startsWith('werkzeug_')) {
      const werkzeug = werkzeugAenderung({ ...hinweis, aktion }, gericht.werkzeuge);
      if (werkzeug) ergebnis.werkzeug = werkzeug;
    }
    hinweise.push(ergebnis);
  }
  return {
    einschaetzung: oberflaechenText(antwort.data.einschaetzung) ?? '',
    hinweise,
    personen: gericht.personen,
    geprueftFuer: kontext.geprueftFuer,
    personenQuelle: kontext.personenQuelle,
    anleitungGeprueft: gericht.anleitung.trim() !== '',
  };
}
