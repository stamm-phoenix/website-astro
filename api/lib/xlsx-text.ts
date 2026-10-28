import { ZipError, readZipEntry, readZipParts } from './zip';
import { decodeXmlEntities } from './docx-text';

/**
 * Plain text of an Excel file (.xlsx): one line per row with the cells separated by „ | “ in
 * their columns (empty cells as empty fields), each
 * sheet after a line with its name. Good enough to hand a Zeitplan to a language model; formulas
 * show their last result, formatting is lost. Numbers below 1 are shown as times and serial
 * numbers of plausible years as dates, since that is how Excel stores both and the styles that
 * would tell are not read.
 */

/** Upper bound of all unpacked parts, against archives that unpack to gigabytes. */
const MAX_UNPACKED_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 2_000;

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxError';
  }
}

/**
 * The XML without namespace prefixes on element names (`<x:row>` → `<row>`), which some
 * programs write instead of a default namespace. Attributes such as `r:id` keep theirs.
 */
function ohnePraefix(xml: string): string {
  return xml.replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, '<$1');
}

/** Text of all `<t>` runs inside an element, e.g. a shared string with formatted parts. */
function runsText(xml: string): string {
  let text = '';
  for (const match of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) {
    text += decodeXmlEntities(match[1] ?? '');
  }
  return text;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((match) => runsText(match[1] ?? ''));
}

const pad = (value: number): string => String(value).padStart(2, '0');

function formatTime(fraction: number): string {
  const minutes = Math.round(fraction * 24 * 60) % (24 * 60);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Days between the start of Excel's 1900 and 1904 date systems. */
const DATE_1904_OFFSET = 1462;

/**
 * A number as Excel shows it in a Zeitplan: times, dates or the number itself. `date1904` for
 * workbooks with the 1904 date system (older Mac files), which count days from 1904.
 */
export function excelNumber(raw: string, date1904 = false): string {
  const number = Number(raw);
  if (!Number.isFinite(number)) return raw;
  if (number > 0 && number < 1) return formatTime(number);
  const value = date1904 ? number + DATE_1904_OFFSET : number;
  // 1982 to 2119 in Excel's day count (1900 date system)
  if (value >= 30_000 && value < 80_000) {
    const day = Math.floor(value);
    const date = new Date(Date.UTC(1899, 11, 30) + day * 86_400_000);
    const text = `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
    return value === day ? text : `${text} ${formatTime(value - day)}`;
  }
  return raw;
}

function cellText(attributes: string, inner: string, strings: string[], date1904: boolean): string {
  const type = /\st="([^"]*)"/.exec(attributes)?.[1] ?? 'n';
  if (type === 'inlineStr') return runsText(inner);
  const value = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
  if (value === undefined) return '';
  if (type === 's') return strings[Number(value)] ?? '';
  if (type === 'b') return value === '1' ? 'WAHR' : 'FALSCH';
  if (type === 'n') return excelNumber(value, date1904);
  return decodeXmlEntities(value);
}

/** Columns kept per row; a Zeitplan uses a few, one per day at most. */
const MAX_COLUMNS = 60;

/** Index of the column of a cell reference, e.g. `C7` → 2; undefined without one. */
export function columnIndex(reference: string | undefined): number | undefined {
  const letters = reference && /^([A-Z]{1,3})\d+$/.exec(reference)?.[1];
  if (!letters) return undefined;
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

/**
 * One line per row, with each cell in its column: empty cells stay as empty fields, so a
 * programme item under „Dienstag“ in column B does not slide under „Montag“ in column A.
 */
function sheetLines(xml: string, strings: string[], date1904: boolean): string[] {
  const lines: string[] = [];
  for (const row of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    if (lines.length >= MAX_ROWS) break;
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = columnIndex(/\sr="([^"]*)"/.exec(cell[1] ?? '')?.[1]) ?? cells.length;
      if (column >= MAX_COLUMNS) continue;
      const text = cellText(cell[1] ?? '', cell[2] ?? '', strings, date1904)
        .replace(/\s+/g, ' ')
        .trim();
      while (cells.length < column) cells.push('');
      cells[column] = text;
    }
    while (cells.length > 0 && cells.at(-1) === '') cells.pop();
    if (cells.length > 0) lines.push(cells.join(' | '));
  }
  return lines;
}

/**
 * Sheet names by their part in the archive, e.g. `xl/worksheets/sheet1.xml` → „Montag“, and
 * whether the workbook counts dates in the 1904 date system.
 */
function workbookInfo(archive: Buffer): { names: Map<string, string>; date1904: boolean } {
  const names = new Map<string, string>();
  let date1904 = false;
  try {
    const workbook = ohnePraefix(
      readZipEntry(archive, 'xl/workbook.xml', MAX_UNPACKED_BYTES)?.toString('utf8') ?? ''
    );
    date1904 = /<workbookPr\b[^>]*\sdate1904="(?:1|true)"/.test(workbook);
    const rels = ohnePraefix(
      readZipEntry(archive, 'xl/_rels/workbook.xml.rels', MAX_UNPACKED_BYTES)?.toString('utf8') ??
        ''
    );
    if (!workbook || !rels) return { names, date1904 };
    const targets = new Map(
      [...rels.matchAll(/<Relationship\s[^>]*>/g)].flatMap((match) => {
        const id = /\sId="([^"]*)"/.exec(match[0])?.[1];
        const target = /\sTarget="([^"]*)"/.exec(match[0])?.[1];
        return id && target ? [[id, target.replace(/^\/?(xl\/)?/, 'xl/')] as const] : [];
      })
    );
    for (const match of workbook.matchAll(/<sheet\s[^>]*>/g)) {
      const name = /\sname="([^"]*)"/.exec(match[0])?.[1];
      const id = /\sr:id="([^"]*)"/.exec(match[0])?.[1];
      const target = id ? targets.get(id) : undefined;
      if (name && target) names.set(target, decodeXmlEntities(name));
    }
  } catch {
    // Without names the sheets are still read, numbered
  }
  return { names, date1904 };
}

const sheetNumber = (name: string): number => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

export function xlsxToText(bytes: Uint8Array): string {
  const archive = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const parts = readZipParts(
      archive,
      (name) => name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(name),
      MAX_UNPACKED_BYTES
    );
    const strings = sharedStrings(
      ohnePraefix(
        parts.find((part) => part.name === 'xl/sharedStrings.xml')?.data.toString('utf8') ?? ''
      ) || undefined
    );
    const sheets = parts
      .filter((part) => part.name.startsWith('xl/worksheets/'))
      .sort((a, b) => sheetNumber(a.name) - sheetNumber(b.name));
    if (sheets.length === 0) throw new XlsxError('No worksheets');
    const { names, date1904 } = workbookInfo(archive);
    return sheets
      .map((sheet, index) => {
        const lines = sheetLines(ohnePraefix(sheet.data.toString('utf8')), strings, date1904);
        return [`# ${names.get(sheet.name) ?? `Tabelle ${index + 1}`}`, ...lines].join('\n');
      })
      .join('\n\n');
  } catch (error: unknown) {
    if (error instanceof XlsxError) throw error;
    if (error instanceof ZipError) throw new XlsxError(error.message);
    throw new XlsxError('Unreadable Excel file');
  }
}
