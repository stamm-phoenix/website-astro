import { jsPDF } from 'jspdf';

/** An invoice of three pages as a PDF, its total on the last one. */
export function rechnung(): Buffer {
  const doc = new jsPDF();
  for (let page = 1; page <= 3; page++) {
    if (page > 1) doc.addPage();
    doc.setFontSize(22);
    doc.text(`Rechnung – Seite ${page} von 3`, 20, 30);
    for (let line = 0; line < 20; line++)
      doc.text(`Artikel ${page}-${line}   1,99 EUR`, 20, 50 + line * 10);
    if (page === 3) doc.text('Summe 119,40 EUR', 20, 270);
  }
  return Buffer.from(doc.output('arraybuffer'));
}
