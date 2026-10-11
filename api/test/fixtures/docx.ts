import { writeZip } from '../../lib/zip';

// Small Word files for tests: `word/document.xml` with the given body, plus an image.

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

export function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

export function paragraph(...runs: string[]): string {
  return `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>${runs
    .map((run) => `<w:r><w:t xml:space="preserve">${run}</w:t></w:r>`)
    .join('')}</w:p>`;
}

export function cell(...paragraphs: string[]): string {
  return `<w:tc><w:tcPr/>${paragraphs.join('')}</w:tc>`;
}

export function docx(body: string): Uint8Array {
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: 'word/media/image1.png', data: Buffer.alloc(2048, 7) },
    { name: 'word/document.xml', data: Buffer.from(documentXml(body)) },
  ]);
}
