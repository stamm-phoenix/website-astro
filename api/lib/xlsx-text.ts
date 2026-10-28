import { ZipError, readZipEntry, readZipParts } from './zip';
import { decodeXmlEntities } from './docx-text';

/**
 * Plain text of an Excel file (.xlsx): one line per row with the cells separated by „ | “, each
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

/** A number as Excel shows it in a Zeitplan: times, dates or the number itself. */
export function excelNumber(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  if (value > 0 && value < 1) return formatTime(value);
  // 1982 to 2119 in Excel's day count (1900 date system)
  if (value >= 30_000 && value < 80_000) {
    const day = Math.floor(value);
    const date = new Date(Date.UTC(1899, 11, 30) + day * 86_400_000);
    const text = `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
    return value === day ? text : `${text} ${formatTime(value - day)}`;
  }
  return raw;
}

function cellText(attributes: string, inner: string, strings: string[]): string {
  const type = /\st="([^"]*)"/.exec(attributes)?.[1] ?? 'n';
  if (type === 'inlineStr') return runsText(inner);
  const value = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
  if (value === undefined) return '';
  if (type === 's') return strings[Number(value)] ?? '';
  if (type === 'b') return value === '1' ? 'WAHR' : 'FALSCH';
  if (type === 'n') return excelNumber(value);
  return decodeXmlEntities(value);
}

function sheetLines(xml: string, strings: string[]): string[] {
  const lines: string[] = [];
  for (const row of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    if (lines.length >= MAX_ROWS) break;
    const cells = [...row[1].matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)]
      .map((cell) =>
        cellText(cell[1] ?? '', cell[2] ?? '', strings)
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter((text) => text !== '');
    if (cells.length > 0) lines.push(cells.join(' | '));
  }
  return lines;
}

/** Sheet names by their part in the archive, e.g. `xl/worksheets/sheet1.xml` → „Montag“. */
function sheetNames(archive: Buffer): Map<string, string> {
  const names = new Map<string, string>();
  try {
    const workbook = readZipEntry(archive, 'xl/workbook.xml', MAX_UNPACKED_BYTES)?.toString('utf8');
    const rels = readZipEntry(archive, 'xl/_rels/workbook.xml.rels', MAX_UNPACKED_BYTES)?.toString(
      'utf8'
    );
    if (!workbook || !rels) return names;
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
  return names;
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
      parts.find((part) => part.name === 'xl/sharedStrings.xml')?.data.toString('utf8')
    );
    const sheets = parts
      .filter((part) => part.name.startsWith('xl/worksheets/'))
      .sort((a, b) => sheetNumber(a.name) - sheetNumber(b.name));
    if (sheets.length === 0) throw new XlsxError('No worksheets');
    const names = sheetNames(archive);
    return sheets
      .map((sheet, index) => {
        const lines = sheetLines(sheet.data.toString('utf8'), strings);
        return [`# ${names.get(sheet.name) ?? `Tabelle ${index + 1}`}`, ...lines].join('\n');
      })
      .join('\n\n');
  } catch (error: unknown) {
    if (error instanceof XlsxError) throw error;
    if (error instanceof ZipError) throw new XlsxError(error.message);
    throw new XlsxError('Unreadable Excel file');
  }
}
