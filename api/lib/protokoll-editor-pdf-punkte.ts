import type { Content } from 'pdfmake/interfaces';
import type {
  OffeneAufgabe,
  ProtokollAufgabe,
  ProtokollPerson,
  ProtokollPunkt,
  PunktTermin,
} from './protokoll-editor-model';
import { personNames, punktNummer } from './protokoll-editor-model';
import { aktionZeitraum } from './protokoll-zeitraum';
import type { MdBlock, MdInline, MdToken } from './protokoll-markdown';
import { MARKED_OPTIONS, markdownTree, normalizeBullets } from './protokoll-markdown';

/**
 * The agenda items in the PDF of the minutes (`protokoll-editor-pdf.ts`): heading, Aktion, date,
 * project, open tasks, the Markdown text, tasks and dates of an item and its sub-items.
 */

export const BRAND = '#003056';
export const RED = '#810a1a';
export const GREY = '#5a5a5a';

/** `YYYY-MM-DD` → `07.10.2026` */
export function formatPdfDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}.${month}.${year}` : iso;
}

export function names(list: ProtokollPerson[]): string {
  return personNames(list);
}

const CODE_BACKGROUND = '#eef0f3';

/** Inline Markdown as PDF text runs; styles of outer runs carry over to inner ones. */
function inlineRuns(nodes: MdInline[]): Content[] {
  return nodes.map((node): Content => {
    switch (node.type) {
      case 'text':
        return { text: node.text };
      case 'br':
        return { text: '\n' };
      case 'code':
        return { text: node.text, background: CODE_BACKGROUND };
      case 'strong':
        return { text: inlineRuns(node.children), bold: true };
      case 'em':
        return { text: inlineRuns(node.children), italics: true };
      case 'del':
        return { text: inlineRuns(node.children), decoration: 'lineThrough' };
      case 'link':
        return {
          text: inlineRuns(node.children),
          link: node.href,
          color: BRAND,
          decoration: 'underline',
        };
      case 'erwaehnung':
        return { text: `@${node.name}`, bold: true, color: BRAND };
    }
  });
}

/** One block of the Markdown tree, laid out like `ProtokollText.svelte` shows it. */
function mdBlock(block: MdBlock): Content {
  switch (block.type) {
    case 'paragraph':
      return { text: inlineRuns(block.children), margin: [0, 0, 0, 4] };
    case 'heading':
      return {
        text: inlineRuns(block.children),
        bold: true,
        color: BRAND,
        fontSize: block.depth <= 2 ? 11.5 : 10.5,
        margin: [0, 3, 0, 3],
      };
    case 'list': {
      const tasks = block.items.some((item) => item.checked !== null);
      const items = block.items.map((item): Content => {
        const content = item.blocks.map(mdBlock);
        if (item.checked === null) return { stack: content };
        // No checkbox glyph in the embedded font: written out like in the editor
        return {
          columns: [
            { text: item.checked ? '[x]' : '[ ]', width: 'auto', color: GREY },
            { stack: content, width: '*' },
          ],
          columnGap: 4,
        };
      });
      if (tasks) return { stack: items, margin: [0, 0, 0, 4] };
      return block.ordered
        ? { ol: items, start: block.start, margin: [0, 0, 0, 4] }
        : { ul: items, margin: [0, 0, 0, 4] };
    }
    case 'code':
      return {
        table: {
          widths: ['*'],
          body: [[{ text: block.text, preserveLeadingSpaces: true, fontSize: 9 }]],
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          fillColor: () => CODE_BACKGROUND,
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
        margin: [0, 0, 0, 4],
      };
    case 'quote':
      return {
        table: { widths: ['*'], body: [[{ stack: block.blocks.map(mdBlock), color: GREY }]] },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: (index: number) => (index === 0 ? 1.5 : 0),
          vLineColor: () => '#c8ced6',
          paddingLeft: () => 8,
        },
        margin: [0, 0, 0, 4],
      };
    case 'hr':
      return {
        canvas: [
          { type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: '#c8ced6' },
        ],
        margin: [0, 3, 0, 6],
      };
    case 'table':
      return {
        table: {
          headerRows: 1,
          body: [
            block.header.map((cell, index) => ({
              text: inlineRuns(cell),
              bold: true,
              alignment: block.align[index] ?? 'left',
            })),
            ...block.rows.map((row) =>
              row.map((cell, index) => ({
                text: inlineRuns(cell),
                alignment: block.align[index] ?? 'left',
              }))
            ),
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#c8ced6',
          vLineColor: () => '#c8ced6',
        },
        margin: [0, 0, 0, 4],
      };
  }
}

/** Splits Markdown into `marked`'s tokens. */
export type Lex = (text: string) => MdToken[];

let lexer: Lex | undefined;

/** `marked` is an ES module; the API is CommonJS, so it is loaded once when first needed. */
export async function loadLexer(): Promise<Lex> {
  if (!lexer) {
    const { Lexer } = await import('marked');
    // marked's tokens are a richer union of the same shape
    lexer = (text) => new Lexer(MARKED_OPTIONS).lex(text) as unknown as MdToken[];
  }
  return lexer;
}

/** The Markdown of an agenda item as PDF blocks; raw HTML stays text, never interpreted. */
function textBlocks(text: string, lex: Lex): Content[] {
  return markdownTree(lex(normalizeBullets(text))).map(mdBlock);
}

function aufgabenBlock(aufgaben: ProtokollAufgabe[]): Content[] {
  const list = aufgaben.filter((aufgabe) => aufgabe.titel.trim());
  if (list.length === 0) return [];
  return [
    {
      table: {
        widths: ['*'],
        body: list.map((aufgabe) => {
          const details = [
            names(aufgabe.zustaendig),
            aufgabe.faellig ? `bis ${formatPdfDate(aufgabe.faellig)}` : '',
          ].filter(Boolean);
          return [
            {
              text: [
                { text: 'Aufgabe: ', bold: true, color: BRAND },
                { text: aufgabe.titel.trim() },
                ...(details.length > 0 ? [{ text: ` – ${details.join(' – ')}`, color: GREY }] : []),
              ],
            },
          ];
        }),
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: (index: number) => (index === 0 ? 1.5 : 0),
        vLineColor: () => RED,
        paddingLeft: () => 6,
        paddingTop: () => 1,
        paddingBottom: () => 1,
      },
      margin: [0, 2, 0, 4],
    },
  ];
}

/** The open tasks discussed in the item, with whether they were ticked off in the meeting. */
function offeneAufgabenBlock(offene: OffeneAufgabe[]): Content[] {
  if (offene.length === 0) return [];
  return [
    {
      table: {
        widths: ['*'],
        body: offene.map((aufgabe) => {
          const details = [
            names(aufgabe.zustaendig),
            aufgabe.faellig ? `bis ${formatPdfDate(aufgabe.faellig)}` : '',
          ].filter(Boolean);
          return [
            {
              text: [
                {
                  text: aufgabe.erledigt ? 'Erledigt: ' : 'Offen: ',
                  bold: true,
                  color: aufgabe.erledigt ? GREY : BRAND,
                },
                { text: aufgabe.titel.trim() },
                ...(details.length > 0 ? [{ text: ` – ${details.join(' – ')}`, color: GREY }] : []),
              ],
            },
          ];
        }),
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: (index: number) => (index === 0 ? 1.5 : 0),
        vLineColor: () => GREY,
        paddingLeft: () => 6,
        paddingTop: () => 1,
        paddingBottom: () => 1,
      },
      margin: [0, 2, 0, 4],
    },
  ];
}

/** `Mo., 02.11.2026, 18:00 Uhr`, as on the page. */
function terminZeit(termin: PunktTermin): string {
  const day = termin.datum
    ? `${['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'][new Date(`${termin.datum}T12:00:00Z`).getUTCDay()]}, ${formatPdfDate(termin.datum)}`
    : '';
  return [day, termin.uhrzeit ? `${termin.uhrzeit} Uhr` : ''].filter(Boolean).join(', ');
}

function termineBlock(termine: PunktTermin[]): Content[] {
  const list = termine.filter((termin) => termin.titel.trim());
  if (list.length === 0) return [];
  return [
    {
      table: {
        widths: ['*'],
        body: list.map((termin) => {
          const details = [terminZeit(termin), termin.ort.trim(), names(termin.zustaendig)].filter(
            Boolean
          );
          return [
            {
              text: [
                { text: 'Termin: ', bold: true, color: BRAND },
                { text: termin.titel.trim() },
                ...(details.length > 0 ? [{ text: ` – ${details.join(' – ')}`, color: GREY }] : []),
              ],
            },
          ];
        }),
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: (index: number) => (index === 0 ? 1.5 : 0),
        vLineColor: () => BRAND,
        paddingLeft: () => 6,
        paddingTop: () => 1,
        paddingBottom: () => 1,
      },
      margin: [0, 2, 0, 4],
    },
  ];
}

export function punktBlock(
  punkt: ProtokollPunkt,
  lex: Lex,
  index: number,
  subIndex?: number
): Content[] {
  const level = subIndex === undefined ? 1 : 2;
  const heading: Content = {
    text: `${punktNummer(index, subIndex)} ${punkt.titel.trim() || 'Ohne Titel'}`,
    style: level === 1 ? 'punkt' : 'unterpunkt',
    // Keeps the heading together with the first lines below it
    headlineLevel: level,
    tocItem: true,
    tocStyle: level === 1 ? 'tocPunkt' : 'tocUnterpunkt',
    tocMargin: level === 1 ? [0, 5, 0, 0] : [14, 1, 0, 0],
  };
  const zeitraum = punkt.aktion ? aktionZeitraum(punkt.aktion) : '';
  const datum = punkt.zeitraum ? aktionZeitraum(punkt.zeitraum) : '';
  const body: Content[] = [
    ...(punkt.aktion
      ? [{ text: `Aktion${zeitraum ? `, ${zeitraum}` : ''}`, style: 'untertitel' }]
      : []),
    ...(datum ? [{ text: `Datum: ${datum}`, style: 'untertitel' }] : []),
    ...(punkt.projekt
      ? [{ text: `Projekt: ${punkt.projekt.titel.trim()}`, style: 'untertitel' }]
      : []),
    ...offeneAufgabenBlock(punkt.offeneAufgaben),
    ...textBlocks(punkt.text, lex),
    ...aufgabenBlock(punkt.aufgaben),
    ...termineBlock(punkt.termine),
  ];
  const unterpunkte = punkt.unterpunkte.flatMap((sub, at) => punktBlock(sub, lex, index, at));
  return [
    heading,
    ...(body.length > 0
      ? [{ stack: body, margin: [level === 1 ? 0 : 12, 0, 0, 2] } as Content]
      : []),
    ...(unterpunkte.length > 0 ? [{ stack: unterpunkte, margin: [12, 0, 0, 0] } as Content] : []),
  ];
}
