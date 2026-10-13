import { parentPort, workerData } from 'node:worker_threads';
const MAX_CHARACTERS = 200_000;
async function extract(): Promise<void> {
  const bytes = workerData as Uint8Array;
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false, verbosity: 0 });

  const pdf = await task.promise;
  if (pdf.numPages > 200) throw new Error('Page limit');
  let text = '';
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

  await task.destroy();
  parentPort!.postMessage(text);
}
void extract().catch(() => process.exit(1));
