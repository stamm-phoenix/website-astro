import { ZipError, readZipEntry } from './zip';

/**
 * Plain text of a Word file (.docx), read from `word/document.xml` of the ZIP archive: one line
 * per paragraph, table rows as one line with the cells separated by „ | “, tabs as spaces.
 * Headers, footers, comments, deleted text of tracked changes and field codes are left out.
 * Good enough to hand the text of minutes to a language model; formatting, numbering and images
 * are lost.
 */

/** Upper bound of the unpacked document XML, against archives that unpack to gigabytes. */
const MAX_DOCUMENT_XML_BYTES = 20 * 1024 * 1024;

export class DocxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxError';
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Resolves the predefined XML entities and character references. */
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

/** A table being read: the finished rows, the cells of the current row and the current cell. */
interface TableState {
  rows: string[];
  cells: string[];
  /** Paragraphs of the current cell. */
  paragraphs: string[];
}

/**
 * Elements whose content is not text of the document: the fallback that repeats the preferred
 * `<mc:Choice>`, deleted text of tracked changes, field codes and paragraph properties (their
 * `<w:tab>` elements are tab stops, not tabs).
 */
const SKIPPED_ELEMENTS = new Set(['mc:Fallback', 'w:del', 'w:delText', 'w:instrText', 'w:pPr']);

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w.:-]+)[^>]*?(\/?)>|([^<]+)/g;

/** Plain text of the main part of a Word document (`word/document.xml`). */
export function documentXmlToText(xml: string): string {
  const lines: string[] = [];
  const tables: TableState[] = [];
  let paragraph = '';
  let inText = false;
  let skipDepth = 0;

  const finishParagraph = (): void => {
    const text = paragraph.replace(/[ \t\u00a0]+/g, ' ').trim();
    paragraph = '';
    const table = tables.at(-1);
    if (table) {
      if (text) table.paragraphs.push(text);
    } else {
      lines.push(text);
    }
  };

  for (const match of xml.matchAll(TOKEN)) {
    const [, cdata, closing, name, selfClosing, text] = match;
    if (skipDepth > 0) {
      if (name && SKIPPED_ELEMENTS.has(name) && !selfClosing) skipDepth += closing ? -1 : 1;
      continue;
    }
    if (text !== undefined || cdata !== undefined) {
      if (inText) paragraph += cdata ?? decodeXmlEntities(text ?? '');
      continue;
    }
    if (!name) continue;
    if (SKIPPED_ELEMENTS.has(name)) {
      if (!closing && !selfClosing) skipDepth = 1;
      continue;
    }

    if (closing) {
      switch (name) {
        case 'w:t':
          inText = false;
          break;
        case 'w:p':
          finishParagraph();
          break;
        case 'w:tc': {
          const table = tables.at(-1);
          if (table) {
            table.cells.push(table.paragraphs.join(' / '));
            table.paragraphs = [];
          }
          break;
        }
        case 'w:tr': {
          const table = tables.at(-1);
          if (table) {
            if (table.cells.some((cell) => cell !== '')) table.rows.push(table.cells.join(' | '));
            table.cells = [];
          }
          break;
        }
        case 'w:tbl': {
          const table = tables.pop();
          if (!table) break;
          const outer = tables.at(-1);
          // A nested table becomes part of the cell it is in
          if (outer) outer.paragraphs.push(...table.rows);
          else lines.push(...table.rows, '');
          break;
        }
      }
      continue;
    }

    switch (name) {
      case 'w:t':
        inText = !selfClosing;
        break;
      case 'w:tab':
      case 'w:ptab':
        paragraph += '\t';
        break;
      case 'w:br':
      case 'w:cr':
        // A line break inside a paragraph, e.g. Shift+Enter
        paragraph += '\n';
        break;
      case 'w:noBreakHyphen':
        paragraph += '-';
        break;
      case 'w:tbl':
        if (!selfClosing) tables.push({ rows: [], cells: [], paragraphs: [] });
        break;
    }
  }

  return lines
    .join('\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text of a Word file; throws `DocxError` if it is not one. */
export function docxToText(docx: Uint8Array): string {
  let xml: Buffer | undefined;
  try {
    xml = readZipEntry(Buffer.from(docx), 'word/document.xml', MAX_DOCUMENT_XML_BYTES);
  } catch (error: unknown) {
    if (error instanceof ZipError || error instanceof RangeError) {
      throw new DocxError('Not a readable Word file');
    }
    throw error;
  }
  if (!xml) throw new DocxError('Not a Word file');
  return documentXmlToText(xml.toString('utf8'));
}
