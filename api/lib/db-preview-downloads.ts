import { completeUpload, listDownloads, newDownloadKey, stageUploadPart } from './downloads';
import { testPicture } from './db-preview';

const PREVIEW_ACTOR = 'preview';

/** A one-page PDF with a line of text, small enough to be built by hand. */
export function testPdf(text: string): Buffer {
  const escaped = text.replace(/[\\()]/g, (char) => `\\${char}`).replace(/[^\x20-\x7e]/g, '?');
  const stream = `BT /F1 18 Tf 72 760 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Invented downloads, two with a preview (matched by file name). */
const PREVIEW_DOWNLOADS: {
  fileName: string;
  text: string;
  category: string;
  preview?: [string, string];
}[] = [
  {
    fileName: 'Packliste Sommerlager (Testdaten).pdf',
    text: 'Packliste Sommerlager - Testdaten der Preview',
    category: 'Lager',
    preview: ['#ffffff', '#c9d6e3'],
  },
  {
    fileName: 'Anmeldung Stammeswochenende (Testdaten).pdf',
    text: 'Anmeldung Stammeswochenende - Testdaten der Preview',
    category: 'Anmeldung',
    preview: ['#ffffff', '#e3d3c9'],
  },
  {
    fileName: 'Liederliste (Testdaten).txt',
    text: 'Liederliste - Testdaten der Preview',
    category: 'Allgemein',
  },
];

export async function seedPreviewDownloads(): Promise<void> {
  const existing = new Set((await listDownloads()).map((file) => file.fileName));
  for (const file of PREVIEW_DOWNLOADS) {
    if (existing.has(file.fileName)) continue;
    const key = newDownloadKey();
    const bytes = file.fileName.endsWith('.pdf')
      ? testPdf(file.text)
      : Buffer.from(`${file.text}\n`, 'utf8');
    await stageUploadPart(key, 0, bytes);
    const preview = file.preview && (await testPicture(420, 594, ...file.preview));
    const result = await completeUpload(
      {
        key,
        fileName: file.fileName,
        size: bytes.length,
        replace: false,
        preview,
        category: file.category,
      },
      PREVIEW_ACTOR
    );
    if (result.status !== 'saved')
      throw new Error(`Preview download ${file.fileName}: ${result.status}`);
  }
}
