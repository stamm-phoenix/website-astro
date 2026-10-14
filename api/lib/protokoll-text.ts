import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { docxToText } from './docx-text';
import { ValidationError } from './pflege-validation';

export const MAX_PROTOKOLL_BYTES = 2 * 1024 * 1024;
const MAX_CHARACTERS = 200_000;

/** Local extraction only. Scans require a text layer; no external OCR service is used. */
export async function protokollToText(bytes: Uint8Array, name: string): Promise<string> {
  if (bytes.byteLength > MAX_PROTOKOLL_BYTES)
    throw new ValidationError({ form: 'Das Protokoll ist zu groß (maximal 2 MB).' });
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
    try {
      text = await extractPdf(bytes);
    } catch {
      throw new ValidationError({
        form: 'Das PDF konnte nicht sicher gelesen werden. Es benötigt eine Textebene, darf nicht passwortgeschützt sein und höchstens 200 Seiten enthalten. Bitte gegebenenfalls manuell übernehmen.',
      });
    }
  } else throw new ValidationError({ form: 'Unterstützt werden DOCX, PDF und TXT.' });
  if (text.length > MAX_CHARACTERS)
    throw new ValidationError({ form: 'Der Protokolltext ist zu lang. Bitte manuell übernehmen.' });
  return text.replace(/\r\n?/g, '\n');
}

/** Keep untrusted decompression off the Functions event loop; terminate stalled parsers. */
function extractPdf(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const copy = Uint8Array.from(bytes);
    const worker = new Worker(join(__dirname, 'protokoll-pdf-worker.js'), {
      workerData: copy,
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    const timer = setTimeout(() => {
      reject(new Error('PDF timeout'));
      void worker.terminate();
    }, 5000);
    worker.once('message', (text: unknown) => {
      if (typeof text === 'string' && text.length <= MAX_CHARACTERS) resolve(text);
      else reject(new Error('Invalid PDF result'));
      void worker.terminate();
    });
    worker.once('error', reject);
    worker.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('PDF worker exited'));
    });
  });
}

export function assertProtokollSize(size: number | undefined): void {
  if (size !== undefined && (!Number.isFinite(size) || size < 0 || size > MAX_PROTOKOLL_BYTES))
    throw new ValidationError({ form: 'Das Protokoll ist zu groß (maximal 2 MB).' });
}
