import { docxToText } from './docx-text';
import { ValidationError } from './pflege-validation';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_CHARACTERS = 200_000;

/** Local extraction only. Scans require a text layer; no external OCR service is used. */
export async function protokollToText(bytes: Uint8Array, name: string): Promise<string> {
  if (bytes.byteLength > MAX_BYTES)
    throw new ValidationError({ form: 'Das Protokoll ist zu groß (maximal 20 MB).' });
  let text: string;
  if (/\.docx$/i.test(name)) text = docxToText(bytes);
  else if (/\.txt$/i.test(name)) {
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? 'utf-16be'
          : 'utf-8';
    try {
      text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      throw new ValidationError({
        form: 'Bitte die Textdatei als UTF-8 oder UTF-16 mit BOM speichern.',
      });
    }
    if (text.includes('\0'))
      throw new ValidationError({ form: 'Die Datei enthält keinen gültigen Klartext.' });
  } else if (/\.pdf$/i.test(name)) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false, verbosity: 0 });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 200) throw new Error('Page limit');
      text = '';
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index);
        const content = await page.getTextContent();
        text +=
          content.items
            .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
            .join('') + '\n';
        page.cleanup();
        if (text.length > MAX_CHARACTERS) throw new Error('Text limit');
      }
      if (!text.trim()) throw new Error('No text layer');
    } catch {
      throw new ValidationError({
        form: 'Das PDF konnte nicht gelesen werden. Es benötigt eine Textebene, darf nicht passwortgeschützt sein und höchstens 200 Seiten enthalten. Aufgaben und Termine können manuell übernommen werden.',
      });
    } finally {
      await task.destroy();
    }
  } else throw new ValidationError({ form: 'Unterstützt werden DOCX, PDF und TXT.' });
  if (text.length > MAX_CHARACTERS)
    throw new ValidationError({ form: 'Der Protokolltext ist zu lang. Bitte manuell übernehmen.' });
  return text.replace(/\r\n?/g, '\n');
}
