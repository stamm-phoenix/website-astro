import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pdfmake from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type {
  ProtokollAufgabe,
  ProtokollInhalt,
  ProtokollPerson,
  ProtokollPunkt,
  PunktTermin,
} from './protokoll-editor-model';
import { aktionZeitraum, personNames, punktNummer } from './protokoll-editor-model';
import type { MdBlock, MdInline, MdToken } from './protokoll-markdown';
import { MARKED_OPTIONS, markdownTree, normalizeBullets } from './protokoll-markdown';

/**
 * The PDF of minutes written in the editor (#277, `docs/protokoll-editor.md`), on the Stamm's
 * letter paper: letterhead with the Stammesvorsitzende on the first page, a small header on the
 * following pages and the DPSG footer on every page. Same layout as the letters of the
 * Abrechnung (`web/src/lib/abrechnungPdf.ts`). Fonts and images are embedded from `api/assets`.
 */

/** A member of the Vorstand in the letterhead. */
export interface PdfVorstand {
  name: string;
  telephone?: string;
  street?: string;
  city?: string;
}

export interface ProtokollPdfInput {
  title: string;
  /** `YYYY-MM-DD` */
  date: string;
  inhalt: ProtokollInhalt;
  vorstaende: PdfVorstand[];
  /** Who approved and when; without it the PDF says it is a draft. */
  freigabe: { by: string; at: Date } | null;
}

const BRAND = '#003056';
const RED = '#810a1a';
const GREY = '#5a5a5a';
const TEXT = '#1e1e1e';
const FONT = 'SourceSans3';

const MM = 72 / 25.4;
const mm = (value: number): number => value * MM;
const MARGIN = mm(18);
const PAGE_WIDTH = mm(210);
const PAGE_HEIGHT = mm(297);
/** Room for the full footer of the first page and the reduced one of the following pages. */
const FULL_BOTTOM = mm(40);
const REDUCED_BOTTOM = mm(18);

const FOOTER_TEXT =
  'Die Deutsche Pfadfinderschaft Sankt Georg (DPSG) ist als anerkannter Träger freier Jugendhilfe Mitglied im Bayerischen Jugendring (BJR) und als Verband katholischer Pfadfinderinnen und Pfadfinder Mitglied im Bund der Deutschen Katholischen Jugend (BDKJ) und der Internationalen Katholischen Konferenz des Pfadfindertums (IKKP). Die DPSG ist Mitglied im Ring deutscher Pfadfinderverbände (RdP) und von der World Organisation of the Scout Movement (WOSM) als Mitgliedsverband der Weltpfadfinderbewegung offiziell anerkannt.';

const ASSETS = join(__dirname, '..', '..', 'assets');
const FONTS = join(ASSETS, 'fonts');

let images: { logo: string; dpsg: string } | undefined;

function dataUrl(file: string): string {
  return `data:image/png;base64,${readFileSync(join(ASSETS, 'protokoll', file)).toString('base64')}`;
}

function setup(): { logo: string; dpsg: string } {
  if (images) return images;
  pdfmake.setFonts({
    [FONT]: {
      normal: join(FONTS, 'SourceSans3-Regular.ttf'),
      bold: join(FONTS, 'SourceSans3-Bold.ttf'),
      italics: join(FONTS, 'SourceSans3-It.ttf'),
      bolditalics: join(FONTS, 'SourceSans3-Bold.ttf'),
    },
  });
  // Only the bundled fonts; the document never loads anything from elsewhere
  pdfmake.setLocalAccessPolicy((path) => path.startsWith(FONTS));
  pdfmake.setUrlAccessPolicy(() => false);
  images = { logo: dataUrl('stammeslilie.png'), dpsg: dataUrl('dpsg-stamm-phoenix.png') };
  return images;
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** `YYYY-MM-DD` → `07.10.2026` */
export function formatPdfDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}.${month}.${year}` : iso;
}

/** `YYYY-MM-DD` → `Mittwoch, 07.10.2026` */
function formatLongDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return `${WEEKDAYS[date.getUTCDay()]}, ${formatPdfDate(iso)}`;
}

function formatDateTime(at: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  }).format(at);
}

/** File name in the folder of the minutes: `JJJJ-MM-TT Titel.pdf`, without forbidden characters. */
export function protokollPdfFileName(date: string, title: string): string {
  const name = title
    .replace(/[\\/:*?"<>|#%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return `${date} ${name || 'Protokoll'}.pdf`;
}

function names(list: ProtokollPerson[]): string {
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
type Lex = (text: string) => MdToken[];

let lexer: Lex | undefined;

/** `marked` is an ES module; the API is CommonJS, so it is loaded once when first needed. */
async function loadLexer(): Promise<Lex> {
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

function punktBlock(punkt: ProtokollPunkt, lex: Lex, index: number, subIndex?: number): Content[] {
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
  const body: Content[] = [
    ...(punkt.aktion
      ? [{ text: `Aktion${zeitraum ? `, ${zeitraum}` : ''}`, style: 'untertitel' }]
      : []),
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

function kopfTable(input: ProtokollPdfInput): Content {
  const { kopf } = input.inhalt;
  const anwesend = kopf.teilnehmende.filter((person) => person.status === 'anwesend');
  const entschuldigt = kopf.teilnehmende.filter((person) => person.status === 'entschuldigt');
  const zeit = kopf.beginn || kopf.ende ? `${kopf.beginn || '–'} bis ${kopf.ende || '–'} Uhr` : '–';
  const rows: [string, string][] = [
    ['Datum', formatLongDate(input.date)],
    ['Sitzungsleitung', names(kopf.sitzungsleitung) || '–'],
    ['Protokoll', names(kopf.protokollant) || '–'],
    ['Beginn und Ende', zeit],
    ['Anwesend', names(anwesend) || '–'],
  ];
  if (entschuldigt.length > 0) rows.push(['Entschuldigt', names(entschuldigt)]);
  if (kopf.externe.trim()) rows.push(['Externe', kopf.externe.trim()]);
  return {
    table: {
      widths: [mm(32), '*'],
      body: rows.map(([label, value]) => [
        { text: label, bold: true, color: BRAND },
        { text: value },
      ]),
    },
    layout: {
      hLineWidth: (index: number, node) =>
        index === 0 || index === (node.table.body as unknown[]).length ? 0.5 : 0,
      vLineWidth: () => 0,
      hLineColor: () => '#c8ced6',
      paddingTop: () => 2,
      paddingBottom: () => 2,
      paddingLeft: () => 0,
    },
    margin: [0, 0, 0, 12],
  };
}

function naechsteBlock(input: ProtokollPdfInput): Content[] {
  const { datum, uhrzeit, ort } = input.inhalt.naechsteSitzung;
  if (!datum && !uhrzeit && !ort.trim()) return [];
  const parts = [
    datum ? formatLongDate(datum) : '',
    uhrzeit ? `${uhrzeit} Uhr` : '',
    ort.trim(),
  ].filter(Boolean);
  return [
    {
      text: 'Nächste Leitendenrunde',
      style: 'punkt',
      headlineLevel: 1,
      tocItem: true,
      tocStyle: 'tocPunkt',
      tocMargin: [0, 5, 0, 0],
    },
    { text: parts.join(', ') },
  ];
}

function briefkopf(input: ProtokollPdfInput): Content {
  const vorstand: Content[] = [
    { text: 'Stammesvorsitzende', bold: true, color: BRAND, fontSize: 9, margin: [0, 0, 0, 3] },
  ];
  for (const person of input.vorstaende) {
    vorstand.push({
      stack: [
        { text: person.name, bold: true },
        ...[person.telephone, person.street, person.city]
          .filter((line): line is string => Boolean(line?.trim()))
          .map((line) => ({ text: line })),
      ],
      margin: [0, 0, 0, 4],
    });
  }
  vorstand.push({ text: 'www.stamm-phoenix.de' }, { text: 'kontakt@stamm-phoenix.de' });
  return {
    columns: [
      { image: 'logo', width: mm(20), height: mm(26) },
      {
        width: '*',
        stack: [
          { text: 'DPSG Stamm Phoenix', bold: true, fontSize: 14, color: BRAND },
          { text: 'Pfarrei Sankt Laurentius', fontSize: 10.5 },
          { text: 'Feldkirchen-Westerham', fontSize: 10.5 },
        ],
        margin: [mm(4), mm(3), 0, 0],
      },
      { width: mm(58), stack: vorstand, fontSize: 8, color: TEXT },
    ],
    margin: [0, 0, 0, mm(10)],
  };
}

function line(width: number): Content {
  return {
    canvas: [
      {
        type: 'line',
        x1: 0,
        y1: 0,
        x2: PAGE_WIDTH - 2 * MARGIN,
        y2: 0,
        lineWidth: width,
        lineColor: RED,
      },
    ],
  };
}

/** Footer of the first page: the DPSG's line, the Stammesnummer, the legal text and logo. */
function fullFooter(currentPage: number, pageCount: number): Content {
  return {
    margin: [MARGIN, mm(2), MARGIN, 0],
    stack: [
      line(1.2),
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Deutsche Pfadfinderschaft Sankt Georg', bold: true, fontSize: 7.5 },
              { text: '13/19/12 Stamm Phoenix Feldkirchen-Westerham', fontSize: 7.5 },
              {
                text: FOOTER_TEXT,
                fontSize: 5.8,
                lineHeight: 1.1,
                color: GREY,
                margin: [0, 3, 0, 0],
              },
            ],
          },
          { image: 'dpsg', width: mm(34), margin: [mm(6), 0, 0, 0] },
        ],
        margin: [0, mm(2.5), 0, 0],
      },
      {
        text: `Seite ${currentPage} von ${pageCount}`,
        fontSize: 7.5,
        color: GREY,
        alignment: 'right',
        margin: [0, mm(1.5), 0, 0],
      },
    ],
  };
}

/** Footer of the following pages: one line with the Stamm and the page number. */
function reducedFooter(currentPage: number, pageCount: number): Content {
  return {
    margin: [MARGIN, mm(4), MARGIN, 0],
    stack: [
      line(0.6),
      {
        columns: [
          {
            width: '*',
            text: 'DPSG · 13/19/12 Stamm Phoenix Feldkirchen-Westerham',
          },
          { width: 'auto', text: `Seite ${currentPage} von ${pageCount}` },
        ],
        fontSize: 7.5,
        color: GREY,
        margin: [0, mm(1.5), 0, 0],
      },
    ],
  };
}

/** Header of the following pages: small logo, Stamm and which minutes these are. */
function reducedHeader(heading: string): Content {
  return {
    columns: [
      { image: 'logo', width: mm(7), height: mm(9) },
      {
        width: '*',
        text: [
          { text: 'DPSG Stamm Phoenix', bold: true, color: BRAND },
          { text: ` · Protokoll ${heading}`, color: GREY },
        ],
        margin: [mm(2), mm(2.5), 0, 0],
      },
    ],
    fontSize: 8.5,
    margin: [MARGIN, mm(8), MARGIN, 0],
  };
}

/**
 * Builds the document; exported for the tests. The first page has the full letterhead and
 * footer and only the table of contents; the minutes follow from the second page on, with a
 * reduced header and footer.
 */
export async function protokollPdfDefinition(
  input: ProtokollPdfInput
): Promise<TDocumentDefinitions> {
  const { logo, dpsg } = setup();
  const lex = await loadLexer();
  const titel = input.title.trim() || 'Protokoll';
  const heading = `${titel} vom ${formatPdfDate(input.date)}`;
  const punkte = input.inhalt.punkte.flatMap((punkt, index) => [
    ...punktBlock(punkt, lex, index),
    { text: '', margin: [0, 0, 0, 6] } as Content,
  ]);
  const deckblatt: Content[] = [
    briefkopf(input),
    { text: titel, style: 'titel' },
    {
      text: `Protokoll vom ${formatLongDate(input.date)}`,
      color: GREY,
      fontSize: 11.5,
      margin: [0, 0, 0, 6],
    },
    input.freigabe
      ? {
          text: `Freigegeben von ${input.freigabe.by} am ${formatDateTime(input.freigabe.at)}`,
          fontSize: 9,
          color: GREY,
          margin: [0, 0, 0, 14],
        }
      : {
          text: 'Entwurf – noch nicht freigegeben',
          bold: true,
          color: RED,
          margin: [0, 0, 0, 14],
        },
    {
      toc: {
        title: { text: 'Inhalt', style: 'punkt' },
        numberStyle: { color: GREY },
      },
    },
  ];
  const protokoll: Content[] = [
    {
      text: 'Sitzung',
      style: 'punkt',
      margin: [0, 0, 0, 3],
      tocItem: true,
      tocStyle: 'tocPunkt',
      tocMargin: [0, 5, 0, 0],
    },
    kopfTable(input),
    ...punkte,
    ...naechsteBlock(input),
  ];
  return {
    pageSize: 'A4',
    // Named once, so each image is embedded once however many pages show it
    images: { logo, dpsg },
    pageMargins: [MARGIN, mm(14), MARGIN, FULL_BOTTOM],
    info: {
      title: `Protokoll: ${heading}`,
      author: 'DPSG Stamm Phoenix',
      subject: titel,
      creator: 'stamm-phoenix.de',
      producer: 'stamm-phoenix.de',
    },
    language: 'de-DE',
    defaultStyle: { font: FONT, fontSize: 10.5, lineHeight: 1.2, color: TEXT },
    styles: {
      titel: { fontSize: 20, bold: true, color: BRAND, margin: [0, 0, 0, 2] },
      punkt: { fontSize: 13, bold: true, color: BRAND, margin: [0, 6, 0, 3] },
      unterpunkt: { fontSize: 11.5, bold: true, color: BRAND, margin: [0, 4, 0, 2] },
      untertitel: { color: GREY, italics: true, margin: [0, -2, 0, 3] },
      tocPunkt: { bold: true, color: BRAND },
      tocUnterpunkt: { fontSize: 10 },
    },
    content: [
      { section: deckblatt, footer: fullFooter, header: null },
      {
        section: protokoll,
        pageMargins: [MARGIN, mm(24), MARGIN, REDUCED_BOTTOM],
        header: () => reducedHeader(heading),
        footer: reducedFooter,
      },
    ],
    // A heading never ends a page on its own: near the bottom it starts the next one
    pageBreakBefore: (node) =>
      node.headlineLevel !== undefined &&
      node.startPosition.top > PAGE_HEIGHT - REDUCED_BOTTOM - mm(22),
  };
}

/** The PDF of the minutes. */
export async function createProtokollPdf(input: ProtokollPdfInput): Promise<Uint8Array> {
  const buffer = await pdfmake.createPdf(await protokollPdfDefinition(input)).getBuffer();
  return new Uint8Array(buffer);
}
