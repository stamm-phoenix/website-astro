import { esserJeMahlzeit } from '../../../api/lib/essen-teilnehmende-model';
import { gerichtWarnungen, mengeText } from '../../../api/lib/essen-gerichte-model';
import { datumKurz } from './essensplanung';
import { ernaehrung, fuerText } from './essensplanungGerichte';
import { einplanungKennung } from './essensplanungEinplanung';
import { esserRechner, kochMenge, zeilenMenge } from './essensplanungRechnung';
import { ERNAEHRUNG_TEXT, zahlText, zeitraumText } from './essensplanungTeilnehmende';
import { parseProtokollMarkdown, type MdBlock, type MdInline } from './protokollMarkdown';
import type {
  Einplanung,
  Gericht,
  GerichtZutat,
  PlanungAnsicht,
  PlanungMahlzeit,
  PlanungZutat,
} from './types';

/**
 * What the views of a Planung show on paper, as plain rows (`docs/essensplanung.md`, PDF): the
 * same texts as on the screen, without jsPDF, so `essensplanungPdf.ts` only lays them out.
 */

/** One ingredient of a dish as listed: amount, name, for whom, note. */
export interface DruckZeile {
  menge: string;
  name: string;
  /** For whom the line is (diet, intolerances, fixed, fewer portions), joined by „ · “. */
  fuer: string;
  hinweis: string;
}

/** „Gluten, Ei“; a name not loaded says so, so a line never reads as if for everyone. */
export function unvertraeglichkeitenText(ids: number[], namen: Map<number, string>): string {
  return ids.map((id) => namen.get(id) ?? 'Unverträglichkeit (Name nicht geladen)').join(', ');
}

const ALLE = { fuerAlles: true, fuerVegetarisch: true, fuerVegan: true, ohne: [], nur: [] };

/** A planned dish with its amounts for who eats at the meal. */
export interface DruckEinplanung {
  /** `1_2_1`: day, meal and dish. */
  kennung: string;
  name: string;
  /** Everybody who eats at the meal, weighted, times the factor of the planned dish. */
  portionen: number;
  zustaendig: string;
  zeilen: DruckZeile[];
}

/** The amounts of a planned dish at its meal, as `EinplanungMengen.svelte` shows them. */
export function einplanungZeilen(
  ansicht: Pick<PlanungAnsicht, 'gerichte' | 'zutaten'>,
  mahlzeit: PlanungMahlzeit,
  einplanung: Einplanung,
  esser: ReturnType<typeof esserRechner>,
  namen: Map<number, string>
): DruckEinplanung {
  const gericht = ansicht.gerichte.find((g) => g.id === einplanung.gerichtId);
  const zutaten = new Map(ansicht.zutaten.map((z) => [z.id, z]));
  const portionen = esser(mahlzeit, ALLE) * einplanung.faktor;
  return {
    kennung: einplanungKennung(mahlzeit, einplanung.id),
    // Ticked off dishes say so, so the plan on paper shows what is done
    name: `${gericht?.name ?? 'Gericht'}${einplanung.status && einplanung.status !== 'offen' ? ` (${einplanung.status})` : ''}`,
    portionen,
    zustaendig: einplanung.zustaendig,
    zeilen: (gericht?.zutaten ?? []).map((zeile) => {
      const zutat = zutaten.get(zeile.planungZutatId);
      const wer = zeile.fest ? 0 : esser(mahlzeit, zeile);
      const menge = gericht ? zeilenMenge(zeile, gericht.personen, wer, einplanung.faktor) : null;
      return {
        name: zutat?.name ?? 'Zutat',
        menge:
          menge === null || zeile.einheit === null
            ? 'nach Gefühl'
            : kochMenge(menge, zeile.einheit, zutat?.abtropfgewicht),
        // Like the card of the dish, so two lines of one ingredient read apart
        fuer: [
          zeile.fest ? 'feste Menge' : '',
          fuerText(zeile) ?? '',
          zeile.nur.length ? `nur bei ${unvertraeglichkeitenText(zeile.nur, namen)}` : '',
          zeile.ohne.length ? `nicht bei ${unvertraeglichkeitenText(zeile.ohne, namen)}` : '',
          !zeile.fest && Math.abs(wer * einplanung.faktor - portionen) > 0.005
            ? `für ${zahlText(wer * einplanung.faktor)} Portionen`
            : '',
        ]
          .filter(Boolean)
          .join(' · '),
        hinweis: zeile.hinweis,
      };
    }),
  };
}

export interface DruckMahlzeit {
  /** „1_2 Mittagessen, 12:30 Uhr“. */
  titel: string;
  /** „ohne Wölflinge“ or empty. */
  ohne: string;
  gerichte: DruckEinplanung[];
}

export interface DruckTag {
  /** „Tag 1 · Sa., 1.8.2027“. */
  titel: string;
  mahlzeiten: DruckMahlzeit[];
}

/** The meal as titled on paper: ID, name and time. */
function mahlzeitTitel(mahlzeit: PlanungMahlzeit): string {
  return `${mahlzeit.kennung} ${mahlzeit.name}${mahlzeit.uhrzeit ? `, ${mahlzeit.uhrzeit} Uhr` : ''}`;
}

/** The plan for the kitchen: every day and meal with the planned dishes and their amounts. */
export function kochplan(ansicht: PlanungAnsicht, namen: Map<number, string>): DruckTag[] {
  const esser = esserRechner(ansicht);
  const gruppen = new Map(ansicht.gruppen.map((g) => [g.id, g.name]));
  return ansicht.tage.map((tag) => ({
    titel: `Tag ${tag.nummer} · ${datumKurz(tag.datum)}`,
    mahlzeiten: tag.mahlzeiten.map((mahlzeit) => ({
      titel: mahlzeitTitel(mahlzeit),
      ohne: mahlzeit.ohneGruppen.length
        ? `ohne ${mahlzeit.ohneGruppen.map((id) => gruppen.get(id) ?? 'Gruppe').join(', ')}`
        : '',
      gerichte: mahlzeit.einplanungen.map((einplanung) =>
        einplanungZeilen(ansicht, mahlzeit, einplanung, esser, namen)
      ),
    })),
  }));
}

/** What a line contains of the intolerances it is not marked „nicht bei“ for. */
export function allergeneText(
  zeile: Pick<GerichtZutat, 'ohne'>,
  zutat: Pick<PlanungZutat, 'allergene'> | undefined,
  namen: Map<number, string>
): string {
  const ids = (zutat?.allergene ?? []).filter((id) => !zeile.ohne.includes(id));
  const bekannt = ids.flatMap((id) => namen.get(id) ?? []);
  // Without the list the names are unknown: never as if there were none
  if (bekannt.length < ids.length) bekannt.push('Allergene (Namen nicht geladen)');
  return bekannt.join(', ');
}

/** The lines of a recipe card, as the card of the dish shows them. */
export function rezeptZeilen(
  gericht: Gericht,
  zutaten: PlanungZutat[],
  namen: Map<number, string>
): DruckZeile[] {
  const jeId = new Map(zutaten.map((z) => [z.id, z]));
  return gericht.zutaten.map((zeile) => {
    const zutat = jeId.get(zeile.planungZutatId);
    const enthalten = allergeneText(zeile, zutat, namen);
    return {
      menge: mengeText(zeile.menge, zeile.einheit, zutat?.abtropfgewicht) ?? 'nach Gefühl',
      name: zutat?.name ?? 'Zutat',
      fuer: [
        zeile.fest ? 'feste Menge' : '',
        fuerText(zeile) ?? '',
        zeile.nur.length ? `nur bei ${unvertraeglichkeitenText(zeile.nur, namen)}` : '',
        zeile.ohne.length ? `nicht bei ${unvertraeglichkeitenText(zeile.ohne, namen)}` : '',
        enthalten ? `enthält ${enthalten}` : '',
        zutat && ernaehrung(zutat) === 'nicht vegetarisch' ? 'nicht vegetarisch' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      hinweis: zeile.hinweis,
    };
  });
}

/** The warnings of a dish as the card shows them, e.g. an ingredient that does not fit a diet. */
export function rezeptWarnungen(gericht: Gericht, zutaten: PlanungZutat[]): string[] {
  return gerichtWarnungen(gericht, new Map(zutaten.map((z) => [z.id, z]))).map((w) => w.text);
}

/** A paragraph of a text with Markdown, flattened for paper. */
export interface DruckAbsatz {
  art: 'ueberschrift' | 'absatz' | 'punkt';
  text: string;
  /** Indent of list items in nested lists, from 0. */
  ebene: number;
}

function inlineText(nodes: MdInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text' || node.type === 'code') return node.text;
      if (node.type === 'br') return '\n';
      if (node.type === 'link') {
        const text = inlineText(node.children);
        // Paper has no links: the address follows the text
        return text && text !== node.href ? `${text} (${node.href})` : node.href;
      }
      return inlineText(node.children);
    })
    .join('');
}

function absaetze(blocks: MdBlock[], ebene: number): DruckAbsatz[] {
  return blocks.flatMap((block): DruckAbsatz[] => {
    switch (block.type) {
      case 'heading':
        return [{ art: 'ueberschrift', text: inlineText(block.children), ebene }];
      case 'paragraph':
        return [{ art: 'absatz', text: inlineText(block.children), ebene }];
      case 'code':
        return [{ art: 'absatz', text: block.text, ebene }];
      case 'quote':
        return absaetze(block.blocks, ebene);
      case 'hr':
        return [];
      case 'table':
        return [block.header, ...block.rows].map((zeile) => ({
          art: 'absatz' as const,
          text: zeile.map(inlineText).join(' | '),
          ebene,
        }));
      case 'list':
        return block.items.flatMap((item, index) => {
          const [erster, ...rest] = absaetze(item.blocks, ebene + 1);
          const zeichen =
            item.checked !== null
              ? item.checked
                ? '[x] '
                : '[ ] '
              : block.ordered
                ? `${block.start + index}. `
                : '';
          const punkt: DruckAbsatz = {
            art: 'punkt',
            text: `${zeichen}${erster?.text ?? ''}`,
            ebene,
          };
          return [punkt, ...rest];
        });
    }
  });
}

/** The instructions of a dish (Markdown) as headings, paragraphs and list items. */
export function anleitungAbsaetze(text: string): DruckAbsatz[] {
  return text.trim() ? absaetze(parseProtokollMarkdown(text), 0) : [];
}

/** One meal in the table of eaters: who eats, by diet. */
export interface EsserZelle {
  titel: string;
  ohne: string;
  personen: number;
  vegetarisch: number;
  vegan: number;
}

/**
 * The eaters as a calendar: one column per day, the meals of a day below each other in their
 * order. Days with fewer meals leave the rest of their column empty.
 */
export function esserKalender(ansicht: PlanungAnsicht): {
  tage: string[];
  zeilen: (EsserZelle | null)[][];
} {
  const esser = esserJeMahlzeit(ansicht);
  const gruppen = new Map(ansicht.gruppen.map((g) => [g.id, g.name]));
  const hoehe = Math.max(0, ...ansicht.tage.map((tag) => tag.mahlzeiten.length));
  return {
    tage: ansicht.tage.map((tag) => `Tag ${tag.nummer} · ${datumKurz(tag.datum)}`),
    zeilen: Array.from({ length: hoehe }, (_, index) =>
      ansicht.tage.map((tag) => {
        const mahlzeit = tag.mahlzeiten[index];
        if (!mahlzeit) return null;
        const zahl = esser.get(mahlzeit.id);
        return {
          titel: `${mahlzeit.kennung} ${mahlzeit.name}`,
          ohne: mahlzeit.ohneGruppen.length
            ? `ohne ${mahlzeit.ohneGruppen.map((id) => gruppen.get(id) ?? 'Gruppe').join(', ')}`
            : '',
          personen: zahl?.personen ?? 0,
          vegetarisch: zahl?.je.vegetarisch.personen ?? 0,
          vegan: zahl?.je.vegan.personen ?? 0,
        };
      })
    ),
  };
}

/** The rows of participants: group, number, diet, intolerances, when they are there, note. */
export function teilnehmendeZeilen(
  ansicht: PlanungAnsicht,
  namen: Map<number, string>
): string[][] {
  const gruppen = new Map(ansicht.gruppen.map((g) => [g.id, g.name]));
  return ansicht.teilnehmende.map((zeile) => [
    gruppen.get(zeile.gruppeId) ?? 'Gruppe',
    String(zeile.anzahl),
    ERNAEHRUNG_TEXT[zeile.ernaehrung],
    unvertraeglichkeitenText(zeile.unvertraeglichkeiten, namen),
    zeitraumText(ansicht, zeile) || 'die ganze Zeit',
    zeile.hinweis,
  ]);
}
